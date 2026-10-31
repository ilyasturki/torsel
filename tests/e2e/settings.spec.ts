import type { APIRequestContext, Page } from '@playwright/test';

import { createBase, createTable, insertRows } from '../../src/lib/core/actions.ts';
import { expect, newAccount, RETRY_RESET, seed, signIn, test } from './harness.ts';

function seedRow(request: APIRequestContext) {
	return seed(request, (ws, commit) => {
		const base = createBase(ws, 'Gym');
		commit(base.changes);
		const table = createTable(ws, base.id, 'Lifts', [{ name: 'Name', type: 'text' }]);
		commit(table.changes);
		commit(insertRows(ws, table.id, [{ [table.fieldIds[0]]: 'Squat' }]).changes);
		return `/app/t/${table.id}`;
	});
}

async function editCell(page: Page, from: string, to: string): Promise<void> {
	await page.getByRole('gridcell', { name: from }).dblclick();
	const cell = page.getByRole('gridcell').getByRole('textbox');
	await cell.fill(to);
	await cell.press('Enter');
	await expect(page.getByRole('gridcell', { name: to })).toBeVisible();
}

test('holds the strict minimum, and says nothing about a sync that works', async ({
	page,
	account
}) => {
	await page.goto('/app/settings');

	await expect(page.getByText(account.email)).toBeVisible();
	await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Agents (MCP)' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Export as JSON' })).toBeVisible();
	await expect(page.getByText('Torsel 0.0.0')).toBeVisible();

	await expect(page.getByLabel('Server address')).toHaveCount(0);
	await expect(page.getByPlaceholder('Ask about your tables')).toBeHidden();
	await expect(page.getByRole('status')).toHaveCount(0);
	await expect(page.getByRole('button', { name: /sync/iu })).toHaveCount(0);
});

test('reports changes waiting offline, then falls silent once they are sent', async ({
	page,
	context,
	account
}) => {
	void account;
	await page.goto(await seedRow(context.request));
	await expect(page.getByRole('gridcell', { name: 'Squat' })).toBeVisible();

	await context.setOffline(true);
	await editCell(page, 'Squat', 'Bench');
	await expect(page.getByRole('status')).toHaveText('Offline, 1 change waiting');

	await context.setOffline(false);
	await expect(page.getByRole('status')).toHaveCount(0);
});

test('an expired session asks to sign in again and shows no e-mail', async ({
	page,
	context,
	account
}) => {
	await page.goto(await seedRow(context.request));
	await expect(page.getByRole('gridcell', { name: 'Squat' })).toBeVisible();

	await context.clearCookies();
	await editCell(page, 'Squat', 'Bench');
	await expect(page.getByRole('status')).toContainText('Session expired, sign in again');

	await page.getByRole('link', { name: 'sign in again' }).click();
	await expect(page).toHaveURL(/\/app\/login\?to=/u);
	await page.getByLabel('Email').fill(account.email);
	await page.getByLabel('Password').fill(account.password);
	await page.getByRole('button', { name: 'Sign in' }).click();

	await expect(page.getByRole('gridcell', { name: 'Bench' })).toBeVisible();
	await expect(page.getByRole('status')).toHaveCount(0);
	await expect
		.poll(async () => {
			const response = await context.request.post('/api/sync', {
				...RETRY_RESET,
				data: { watermark: 0, push: [] }
			});
			return JSON.stringify(await response.json());
		})
		.toContain('Bench');
});

test('after a 401 the settings offer a sign-in link instead of the e-mail', async ({
	page,
	context,
	account
}) => {
	await page.goto('/app/settings');
	await expect(page.getByText(account.email)).toBeVisible();

	await context.clearCookies();
	await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

	await expect(page.getByRole('status')).toContainText('Session expired');
	await expect(page.getByText(account.email)).toHaveCount(0);
	await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
});

test('a failed sync offers a retry that clears it', async ({ page, context, account }) => {
	void account;
	await page.goto(await seedRow(context.request));
	await expect(page.getByRole('gridcell', { name: 'Squat' })).toBeVisible();

	await page.route('**/api/sync', (route) =>
		route.fulfill({ status: 400, json: { message: 'raw server wording' } })
	);
	await editCell(page, 'Squat', 'Bench');
	await expect(page.getByRole('status')).toHaveText(/Sync failed,\s+retry/u);

	await page.unroute('**/api/sync');
	await page.getByRole('button', { name: 'retry' }).click();
	await expect(page.getByRole('status')).toHaveCount(0);
});

test('another account’s unsynced data can be erased', async ({ page, context, account }) => {
	void account;
	await page.goto(await seedRow(context.request));
	await expect(page.getByRole('gridcell', { name: 'Squat' })).toBeVisible();

	await page.route('**/api/sync', (route) => route.fulfill({ status: 400, json: {} }));
	await editCell(page, 'Squat', 'Bench');
	await expect(page.getByRole('status')).toContainText('Sync failed');

	await context.clearCookies();
	await signIn(context, newAccount());
	await page.unroute('**/api/sync');
	await page.reload();

	await expect(page.getByRole('status')).toContainText('another account’s data');
	await page.getByRole('button', { name: 'erase it' }).click();
	await expect(page.getByRole('status')).toHaveCount(0);
	// The erase ends in the app's own reload, which can interrupt this navigation.
	await expect(async () => {
		await page.goto('/app');
		await expect(page.getByText('Lifts')).toHaveCount(0);
	}).toPass();
});

test('token errors are shown, and a token can be minted and revoked', async ({ page, account }) => {
	void account;
	await page.goto('/app/settings');
	await expect(page.getByRole('button', { name: 'Create token' })).toBeVisible();

	await page.route('**/api/auth/tokens', (route) =>
		route.request().method() === 'POST'
			? route.fulfill({ status: 400, json: { message: 'raw server wording' } })
			: route.fallback()
	);
	await page.getByRole('button', { name: 'Create token' }).click();
	await expect(page.getByRole('alert')).toHaveText('Couldn’t create the token. Try again.');
	await page.unroute('**/api/auth/tokens');

	await page.getByRole('button', { name: 'Create token' }).click();
	await expect(page.getByText('Copy it now.')).toBeVisible();
	await expect(page.getByRole('alert')).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Revoke' })).toBeVisible();

	await page.route('**/api/auth/tokens/*', (route) => route.fulfill({ status: 400, json: {} }));
	await page.getByRole('button', { name: 'Revoke' }).click();
	await expect(page.getByRole('alert')).toHaveText('Couldn’t revoke the token. Try again.');
	await page.unroute('**/api/auth/tokens/*');

	await page.getByRole('button', { name: 'Revoke' }).click();
	await expect(page.getByRole('button', { name: 'Revoke' })).toHaveCount(0);
	await expect(page.getByRole('alert')).toHaveCount(0);
});
