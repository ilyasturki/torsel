import { spawnSync } from 'node:child_process';
import { randomInt, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { APIRequestContext, BrowserContext, Locator, Page } from '@playwright/test';
import { test as base, expect } from '@playwright/test';

import { createBase, createTable, insertRows } from '../../src/lib/core/actions.ts';
import { Hlc } from '../../src/lib/core/clock.ts';
import type { Change, Rec } from '../../src/lib/core/model.ts';
import { MAX_PUSH } from '../../src/lib/core/protocol.ts';
import { Workspace } from '../../src/lib/core/workspace.ts';
import type { FakeStep } from './fake-anthropic.ts';

export type Account = { email: string; password: string };

const PASSWORD = 'e2e-suite-password-not-secret';

const ROOT = join(import.meta.dirname, '../..');

// Node drops a connection idle for 5s and a loaded machine can reuse it just then; maxRetries only retries that ECONNRESET.
export const RETRY_RESET = { maxRetries: 3 };

export function newAccount(database: string = base.info().project.metadata.database): Account {
	const account = { email: `${randomUUID()}@e2e.test`, password: PASSWORD };
	const created = spawnSync('node', ['scripts/account.ts', 'create', account.email], {
		cwd: ROOT,
		env: { ...process.env, DATABASE_PATH: database },
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
		...RETRY_RESET,
		data: { email: account.email, password: account.password, client: 'web' }
	});
	expect(response.status(), 'sign-in through the API').toBe(204);
}

export function newAddress(): string {
	return `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
}

export function freshEmail(): string {
	return `${randomUUID()}@e2e.test`;
}

export function passwordField(page: Page): Locator {
	return page.locator('input[name="password"]');
}

export async function passwordSignIn(page: Page, account: Account): Promise<void> {
	await page.getByLabel('Email').fill(account.email);
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await passwordField(page).fill(account.password);
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

export const cell = (page: Page, name: string): Locator =>
	page.getByRole('gridcell', { name, exact: true });

export const undoButton = (page: Page): Locator =>
	page.getByRole('button', { name: 'Undo', exact: true });

export const redoButton = (page: Page): Locator =>
	page.getByRole('button', { name: 'Redo', exact: true });

export type SignInMail = { link: string | null; code: string };

/** The newest mail the server logged instead of sending to this address. */
export async function mailTo(email: string): Promise<SignInMail> {
	let found: SignInMail | undefined;
	await expect
		.poll(() => {
			const line = readFileSync(base.info().project.metadata.log, 'utf8')
				.split('\n')
				.findLast((text) => text.startsWith('[email]') && text.includes(` to ${email} `));
			const code = line?.match(/\(code: (\d{6})\)/u)?.[1];
			if (line === undefined || code === undefined) {
				return false;
			}
			found = { code, link: line.match(/\(link: (\S+)\)/u)?.[1] ?? null };
			return true;
		}, 'the server logs the mail')
		.toBe(true);
	return found as SignInMail;
}

export function expireEmailTokens(): void {
	const db = new DatabaseSync(base.info().project.metadata.database, { timeout: 30_000 });
	db.exec('update email_tokens set expires_at = 0');
	db.close();
}

/** Queues what the fake model answers; a prompt holding the returned key gets these steps. */
export async function script(request: APIRequestContext, steps: FakeStep[]): Promise<string> {
	const key = `script-${randomUUID()}`;
	const response = await request.post(`${process.env.TORSEL_TEST_FAKE ?? ''}/__script?key=${key}`, {
		data: { steps }
	});
	expect(response.ok()).toBe(true);
	return key;
}

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
	const records = [...push.values()];
	for (let from = 0; from < records.length; from += MAX_PUSH) {
		const response = await request.post('/api/sync', {
			...RETRY_RESET,
			data: { watermark: 0, push: records.slice(from, from + MAX_PUSH) }
		});
		expect(response.ok(), 'seeding through /api/sync').toBe(true);
	}
	return result;
}

/** One table with one row, Squat at 100 kg, in a base named Gym; returns its path. */
export function seedLifts(request: APIRequestContext): Promise<string> {
	return seed(request, (ws, commit) => {
		const base = createBase(ws, 'Gym');
		commit(base.changes);
		const lifts = createTable(ws, base.id, 'Lifts', [
			{ name: 'Exercise', type: 'text' },
			{ name: 'Kg', type: 'number' }
		]);
		commit(lifts.changes);
		commit(
			insertRows(ws, lifts.id, [{ [lifts.fieldIds[0]]: 'Squat', [lifts.fieldIds[1]]: 100 }]).changes
		);
		return `/app/t/${lifts.id}`;
	});
}

export async function editCell(page: Page, from: string, to: string): Promise<void> {
	await cell(page, from).dblclick();
	await page.getByRole('gridcell').getByRole('textbox').fill(to);
	await page.getByRole('gridcell').getByRole('textbox').press('Enter');
	await expect(cell(page, to)).toBeVisible();
}

export const askButton = (page: Page): Locator => page.getByRole('button', { name: /^Ask/u });

export const askPanel = (page: Page): Locator => page.locator('aside[aria-label="Ask"]');

/** On the page of `seedLifts`: the assistant adds a Deadlift by itself, and the panel stays open. */
export async function askAddsDeadlift(page: Page, request: APIRequestContext): Promise<void> {
	const key = await script(request, [
		{
			blocks: [
				{
					type: 'tool',
					id: 'toolu_add',
					name: 'add_rows',
					input: { base: 'Gym', table: 'Lifts', rows: [{ Exercise: 'Deadlift', Kg: 140 }] }
				}
			]
		},
		{ blocks: [{ type: 'text', text: 'Logged.' }] }
	]);
	await askButton(page).click();
	await page.getByPlaceholder('Ask about your tables').fill(`${key} log a deadlift`);
	await page.getByRole('button', { name: 'Send' }).click();
	await expect(page.getByTestId('thread').getByText('Logged.')).toBeVisible();
	await expect(page.getByText('2 rows')).toBeVisible();
}

// What says nothing about the app: Vite's client, Chromium's own line for a 4xx the page
// asked for or a request a spec's `setOffline` cut, and SQLite's loader when a spec navigates
// while its wasm still downloads.
const IGNORED_CONSOLE = [
	/\[vite\]/u,
	/Failed to load resource: the server responded with a status of 4\d\d/u,
	/Failed to load resource: net::ERR_INTERNET_DISCONNECTED/u,
	/wasm streaming compile failed: .*(Response body loading was aborted|Failed to fetch)/u,
	/falling back to ArrayBuffer instantiation/u
];

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
	account: Account;
	pageErrors: string[];
};

export const test = base.extend<Fixtures>({
	// Not on the app project: a cross-origin page would need its preflight to allow the header.
	// oxlint-disable-next-line no-empty-pattern
	extraHTTPHeaders: async ({}, use, info) => {
		await use(info.project.name === 'app' ? {} : { 'x-forwarded-for': newAddress() });
	},
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
