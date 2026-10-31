import type { BrowserContext, Page } from '@playwright/test';

import type { Account } from './harness.ts';
import {
	expect,
	freshEmail,
	mailTo,
	newAccount,
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
	await expect(page.getByLabel('Server address')).toBeVisible();
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
	await expect(panel.getByRole('link', { name: 'Sign in to use it' })).toBeVisible();
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
