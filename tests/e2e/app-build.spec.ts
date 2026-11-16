import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { BrowserContext, Page } from '@playwright/test';

import { createBase, createTable, insertRows } from '../../src/lib/core/actions.ts';
import { Hlc } from '../../src/lib/core/clock.ts';
import type { Change, Rec } from '../../src/lib/core/model.ts';
import { Workspace } from '../../src/lib/core/workspace.ts';

import home from '../../src/lib/i18n/home.ts';
import names from '../../src/lib/i18n/names.ts';
import shell from '../../src/lib/i18n/shell.ts';

import type { Account } from './harness.ts';
import {
	expect,
	freshEmail,
	mailTo,
	newAccount,
	openTable,
	passwordField,
	passwordSignIn,
	RETRY_RESET,
	test
} from './harness.ts';

const SERVER = process.env.TORSEL_TEST_APP_SERVER ?? '';

async function connectAndSignIn(page: Page, account: Account): Promise<void> {
	await page.goto('/app/settings');
	await page.getByLabel('Server address').fill(SERVER);
	await page.getByRole('button', { name: 'Connect' }).click();
	await page.getByRole('link', { name: 'Sign in', exact: true }).click();
	await passwordSignIn(page, account);
	await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}

function deviceHeaders(page: Page): Promise<{ authorization: string }> {
	return page
		.evaluate(() => localStorage.getItem('torsel.token'))
		.then((token) => ({ authorization: `Bearer ${token}` }));
}

async function revokeDevice(page: Page, context: BrowserContext): Promise<void> {
	const headers = await deviceHeaders(page);
	const listed = await context.request.get(`${SERVER}/api/auth/tokens`, {
		...RETRY_RESET,
		headers
	});
	const tokens: { id: string; kind: string }[] = await listed.json();
	const device = tokens.find((token) => token.kind === 'device');
	const revoked = await context.request.delete(`${SERVER}/api/auth/tokens/${device?.id}`, {
		...RETRY_RESET,
		headers: { ...headers, 'content-type': 'application/json' }
	});
	expect(revoked.ok()).toBe(true);
}

test('a phone with no server stays silent and keeps its data', async ({ page }) => {
	await page.goto('/app');
	await page.getByRole('button', { name: 'New table' }).first().click();
	await expect(page.getByRole('heading', { name: 'Table 1' })).toBeVisible();
	expect(
		await page.evaluate(() =>
			navigator.serviceWorker.getRegistrations().then((found) => found.length)
		),
		'its files are already local: no worker'
	).toBe(0);

	await page.goto('/app/settings');
	await expect(page.getByLabel('Server address')).toHaveAttribute(
		'placeholder',
		'https://torsel.example.com'
	);
	await expect(page.getByText('Leaving this device for good?')).toBeVisible();
	await expect(page.getByRole('link', { name: 'Settings' })).toHaveCount(0);
	await expect(
		page.getByRole('link', { name: 'Back' }),
		'home, coming from nowhere'
	).toHaveAttribute('href', '/app');
	await expect(page.getByText('Torsel 0.0.0')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Account' })).toHaveCount(0);
	await expect(page.getByRole('heading', { name: 'Agents (MCP)' })).toHaveCount(0);

	await page.waitForTimeout(2000);
	await expect(page.getByRole('status')).toHaveCount(0);
});

test('the assistant offers sign-in once a server is connected, and not before', async ({
	page
}) => {
	await page.goto('/app/settings');
	await expect(page.getByLabel('Server address')).toBeVisible();
	await expect(page.getByRole('button', { name: /^Ask/u })).toHaveCount(0);

	await page.getByLabel('Server address').fill(SERVER);
	await page.getByRole('button', { name: 'Connect' }).click();
	await page.getByRole('button', { name: /^Ask/u }).click();

	const panel = page.locator('aside[aria-label="Ask"]');
	await expect(panel.getByRole('link', { name: 'Sign in to use the assistant' })).toBeVisible();
	await expect(panel.getByPlaceholder('Ask about your tables')).toHaveCount(0);
});

test('a wrong server address reads in plain words', async ({ page }) => {
	await page.goto('/app/settings');
	await page.getByLabel('Server address').fill('http://127.0.0.1:9');
	await page.route('http://127.0.0.1:9/**', (route) => route.abort('internetdisconnected'));
	await page.getByRole('button', { name: 'Connect' }).click();
	await expect(page.getByRole('alert')).toHaveText('Can’t reach this server.');
});

test('the server section collapses once connected, and data reaches the server', async ({
	page,
	context
}) => {
	const account = newAccount();
	await page.goto('/app');
	await page.getByRole('button', { name: 'New table' }).first().click();
	await expect(page.getByRole('heading', { name: 'Table 1' })).toBeVisible();

	await connectAndSignIn(page, account);

	await expect(page.getByText(`Server: ${SERVER}`)).toBeVisible();
	await expect(page.getByLabel('Server address')).toBeHidden();
	await page.getByText(`Server: ${SERVER}`).click();
	await expect(page.getByLabel('Server address')).toBeVisible();

	const headers = await deviceHeaders(page);
	await expect
		.poll(async () => {
			const response = await context.request.post(`${SERVER}/api/sync`, {
				...RETRY_RESET,
				headers,
				data: { watermark: 0, push: [] }
			});
			return JSON.stringify(await response.json());
		})
		.toContain('Table 1');
	await expect(page.getByRole('status')).toHaveCount(0);
});

test('a revoked device asks to sign in again and shows no e-mail', async ({ page, context }) => {
	const account = newAccount();
	await connectAndSignIn(page, account);

	await revokeDevice(page, context);
	await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

	await expect(page.getByRole('status')).toContainText('Session expired');
	await expect(page.getByText(account.email)).toHaveCount(0);

	await page.getByRole('link', { name: 'sign in again' }).click();
	await passwordSignIn(page, account);
	await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
	await expect(page.getByRole('status')).toHaveCount(0);
});

test('signing out on a phone ends its session on the server', async ({ page, context }) => {
	const account = newAccount();
	await connectAndSignIn(page, account);
	const headers = await deviceHeaders(page);

	await page.getByRole('button', { name: 'Sign out' }).click();
	await expect(page.getByText(account.email)).toHaveCount(0);

	const session = await context.request.get(`${SERVER}/api/auth/session`, {
		...RETRY_RESET,
		headers
	});
	expect(await session.json()).toMatchObject({ user: null });
});

test('a boot with the server out of reach retries when the network returns', async ({ page }) => {
	const account = newAccount();
	await connectAndSignIn(page, account);

	const session = `${SERVER}/api/auth/session`;
	await page.route(session, (route) => route.abort('internetdisconnected'));
	await page.reload();
	await expect(page.getByText('Can’t reach the server right now.')).toBeVisible();
	await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toHaveCount(0);

	await page.unroute(session);
	await page.evaluate(() => window.dispatchEvent(new Event('online')));
	await expect(page.getByText(account.email)).toBeVisible();
});

test('the login screen picks a server, then signs in by emailed code', async ({ page }) => {
	const account = newAccount();

	await page.goto('/app/login?to=%2Fapp%2Fsettings');
	await page.getByLabel('Server address').fill(SERVER);
	await page.getByRole('button', { name: 'Connect' }).click();

	await expect(page.getByText(`Server: ${SERVER}`)).toBeVisible();
	await expect(page.getByRole('link', { name: 'Continue with Google' })).toHaveCount(0);
	await expect(page.getByRole('link', { name: 'terms' })).toHaveAttribute(
		'href',
		`${SERVER}/terms`
	);

	await page.getByLabel('Email').fill(account.email);
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await page.getByRole('button', { name: 'Email me a code' }).click();
	await expect(page.getByRole('status')).toContainText('code');

	const { code } = await mailTo(account.email);
	await page.getByLabel('Digit 1 of 6').fill(code);

	await expect(page).toHaveURL(/\/app\/settings$/u);
	await expect(page.getByText(account.email)).toBeVisible();
	expect(await page.evaluate(() => localStorage.getItem('torsel.token'))).toMatch(/^ts_/u);
});

test('a sign-up on the phone keeps its password: the claim comes back with the code', async ({
	page,
	context
}) => {
	const account = { email: freshEmail(), password: 'phone-chosen-password' };

	await page.goto('/app/login');
	await page.getByLabel('Server address').fill(SERVER);
	await page.getByRole('button', { name: 'Connect' }).click();
	await page.getByLabel('Email').fill(account.email);
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await passwordField(page).fill(account.password);
	await page.getByRole('button', { name: 'Create account' }).click();

	const { code } = await mailTo(account.email);
	await page.getByLabel('Digit 1 of 6').fill(code);
	await expect(page).toHaveURL(/\/app$/u);

	const login = await context.request.post(`${SERVER}/api/auth/login`, {
		...RETRY_RESET,
		data: { ...account, client: 'device', label: 'check' }
	});
	expect(login.status()).toBe(201);
});

test('an image reaches the phone with its device token, from a server on another origin', async ({
	page,
	context
}) => {
	const poster = readFileSync(join(import.meta.dirname, 'images/poster.jpg'));
	const still = readFileSync(join(import.meta.dirname, 'images/still.jpg'));
	const id = createHash('sha256').update(poster).digest('hex');
	await connectAndSignIn(page, newAccount());
	const headers = await deviceHeaders(page);

	const ws = new Workspace();
	const hlc = new Hlc('app-images');
	const records = new Map<string, Rec>();
	const commit = (changes: Change[]): void => {
		for (const change of changes) {
			const { rec } = ws.stamp(change, hlc.tick());
			records.set(rec.id, rec);
		}
	};
	const base = createBase(ws, 'Films');
	commit(base.changes);
	const table = createTable(
		ws,
		base.id,
		'Movies',
		[
			{ name: 'Title', type: 'text' },
			{ name: 'Poster', type: 'image' }
		],
		() => [{ name: names.en.views.grid, type: 'grid', config: {} }]
	);
	commit(table.changes);
	const ref = { id, type: 'image/jpeg', w: 342, h: 513, size: poster.length, name: 'dune.jpg' };
	commit(
		insertRows(ws, table.id, [{ [table.fieldIds[0]]: 'Dune', [table.fieldIds[1]]: [ref] }]).changes
	);

	const stored = await context.request.post(
		`${SERVER}/api/blobs/${base.id}/${id}?size=${poster.length}&offset=0`,
		{
			...RETRY_RESET,
			headers: { ...headers, 'content-type': 'application/octet-stream' },
			data: poster
		}
	);
	expect(stored.ok()).toBe(true);
	const synced = await context.request.post(`${SERVER}/api/sync`, {
		...RETRY_RESET,
		headers,
		data: { watermark: 0, push: [...records.values()] }
	});
	expect(synced.ok()).toBe(true);

	await page.goto('/app');
	await openTable(page, 'Movies');
	const image = page
		.getByRole('row')
		.filter({ hasText: 'Dune' })
		.getByRole('img', { name: 'dune.jpg' });
	await expect(image).toBeVisible();
	await expect(image).toHaveAttribute('src', /^blob:/u);

	await page.getByRole('row').filter({ hasText: 'Dune' }).locator('td[aria-colindex="3"]').click();
	await page.keyboard.press('Enter');
	await page
		.getByRole('dialog', { name: 'Poster' })
		.locator('input[type="file"]:not([capture])')
		.setInputFiles({ name: 'still.jpg', mimeType: 'image/jpeg', buffer: still });
	await expect
		.poll(async () => {
			const response = await context.request.post(`${SERVER}/api/sync`, {
				...RETRY_RESET,
				headers,
				data: { watermark: 0, push: [] }
			});
			const { records: rows } = (await response.json()) as { records: Rec[] };
			const row = rows.find((record) => record.kind === 'row' && record.parent === table.id);
			const refs = (row?.data[table.fieldIds[1]] ?? []) as { id: string }[];
			const added = refs.find((item) => item.id !== id);
			if (added === undefined) return 0;
			const bytes = await context.request.get(`${SERVER}/api/blobs/${base.id}/${added.id}`, {
				...RETRY_RESET,
				headers
			});
			return bytes.status();
		})
		.toBe(200);
});

test.describe('on a phone in French', () => {
	test.use({ locale: 'fr-FR' });

	test('the static build opens in French', async ({ page }) => {
		await page.goto('/app');
		await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
		await page.getByRole('button', { name: home.fr.newTable }).first().click();
		await expect(page.getByRole('heading', { name: names.fr.table(1) })).toBeVisible();
		await expect(page.getByRole('link', { name: shell.fr.allTables })).toBeVisible();
	});
});
