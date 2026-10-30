import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';
import { test as base, expect } from '@playwright/test';

import { Hlc } from '../../src/lib/core/clock.ts';
import type { Change, Rec } from '../../src/lib/core/model.ts';
import { Workspace } from '../../src/lib/core/workspace.ts';

export type Account = { email: string; password: string };

const PASSWORD = 'e2e-suite-password-not-secret';

const ROOT = join(import.meta.dirname, '../..');

/** Accounts only exist through the CLI, so a spec's account is made the way an operator makes one. */
export function newAccount(): Account {
	const account = { email: `${randomUUID()}@e2e.test`, password: PASSWORD };
	const created = spawnSync('node', ['scripts/account.ts', 'create', account.email], {
		cwd: ROOT,
		env: { ...process.env, DATABASE_PATH: process.env.TORSEL_TEST_DB },
		input: account.password,
		encoding: 'utf8'
	});
	if (created.status !== 0) {
		throw new Error(`could not create an account: ${created.stderr}`);
	}
	return account;
}

/** `context.request` shares its cookies with the context's pages. */
export async function signIn(context: BrowserContext, account: Account): Promise<void> {
	const response = await context.request.post('/api/auth/login', {
		data: { email: account.email, password: account.password, client: 'web' }
	});
	expect(response.status(), 'sign-in through the API').toBe(204);
}

/** Lays data down on the server as a client's sync would, for what a spec does not itself exercise. */
export async function seed<T>(
	request: APIRequestContext,
	build: (ws: Workspace, commit: (changes: Change[]) => void) => T
): Promise<T> {
	const ws = new Workspace();
	const hlc = new Hlc('e2e');
	const push = new Map<string, Rec>();
	const result = build(ws, (changes) => {
		for (const change of changes) {
			const { rec } = ws.stamp(change, hlc.tick());
			push.set(rec.id, rec);
		}
	});
	const response = await request.post('/api/sync', {
		data: { watermark: 0, push: [...push.values()] }
	});
	expect(response.ok(), 'seeding through /api/sync').toBe(true);
	return result;
}

// What says nothing about the app: Vite's client, and Chromium's own line for a 4xx the page
// asked for or a request a spec's `setOffline` cut.
const IGNORED_CONSOLE = [
	/\[vite\]/u,
	/Failed to load resource: the server responded with a status of 4\d\d/u,
	/Failed to load resource: net::ERR_INTERNET_DISCONNECTED/u
];

/** Fails the test on a runtime error, a console error or a server 5xx. */
export function watchErrors(page: Page, errors: string[]): void {
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('response', (response) => {
		if (response.status() >= 500) {
			errors.push(`${response.status()} ${response.url()}`);
		}
	});
	page.on('console', (message) => {
		const text = message.text();
		if (message.type() === 'error' && !IGNORED_CONSOLE.some((ignored) => ignored.test(text))) {
			errors.push(`console: ${text}`);
		}
	});
}

type Fixtures = {
	/** A fresh account, signed in on this test's context. */
	account: Account;
	pageErrors: string[];
};

export const test = base.extend<Fixtures>({
	account: async ({ context }, use) => {
		const account = newAccount();
		await signIn(context, account);
		await use(account);
	},
	pageErrors: [
		async ({ page }, use) => {
			const errors: string[] = [];
			watchErrors(page, errors);
			await use(errors);
			expect(errors, 'the page logged errors').toEqual([]);
		},
		{ auto: true }
	]
});

export { expect };
