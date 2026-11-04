import type { APIRequestContext, Locator, Page } from '@playwright/test';

import { createBase, createTable, createView, insertRows } from '../../src/lib/core/actions.ts';
import { expect, seed, tablePath, test, toastButton } from './harness.ts';

const onPhone = (): boolean => test.info().project.name === 'phone';

const row = (page: Page, name: string): Locator =>
	page.locator('main a[data-home-row]').filter({ hasText: name });

function seedHome(request: APIRequestContext) {
	return seed(request, (ws, commit) => {
		const body = createBase(ws, 'Body');
		commit(body.changes);
		const weighIns = createTable(ws, body.id, 'Weigh-ins', [
			{ name: 'Date', type: 'date' },
			{ name: 'Kg', type: 'number' }
		]);
		commit(weighIns.changes);
		const [date, kg] = weighIns.fieldIds;
		commit(
			insertRows(ws, weighIns.id, [
				{ [date]: '2026-10-26', [kg]: 80 },
				{ [date]: '2026-10-27', [kg]: 82 },
				{ [date]: '2026-10-28', [kg]: 85.5 }
			]).changes
		);
		const curve = createView(ws, weighIns.id, {
			name: 'Curve',
			type: 'chart',
			config: { kind: 'line', x: date, agg: 'avg', y: kg, rolling: 7 }
		});
		commit(curve.changes);
		commit(createTable(ws, body.id, 'Blank', [{ name: 'Name', type: 'text' }]).changes);

		const shopping = createBase(ws, 'Shopping');
		commit(shopping.changes);
		const list = createTable(ws, shopping.id, 'List', [
			{ name: 'Item', type: 'text' },
			{ name: 'Bought', type: 'check' }
		]);
		commit(list.changes);
		const [item, bought] = list.fieldIds;
		commit(
			insertRows(ws, list.id, [
				{ [item]: 'Apples', [bought]: true },
				{ [item]: 'Milk', [bought]: false },
				{ [item]: 'Rice', [bought]: false }
			]).changes
		);
		const shops = createTable(ws, shopping.id, 'Shops', [{ name: 'Name', type: 'text' }]);
		commit(shops.changes);
		commit(
			insertRows(ws, shops.id, [
				{ [shops.fieldIds[0]]: 'Market' },
				{ [shops.fieldIds[0]]: 'Bakery' }
			]).changes
		);
		return { weighIns: weighIns.id, curve: curve.id };
	});
}

test('the home leads each table with the figure it already charts or ticks, by base', async ({
	page,
	context,
	account
}) => {
	void account;
	await seedHome(context.request);
	await page.goto('/app');

	await expect(page.getByRole('heading', { name: 'Body', level: 2 })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Shopping', level: 2 })).toBeVisible();

	const weighIns = row(page, 'Weigh-ins');
	await expect(weighIns).toContainText('82.5');
	await expect(weighIns).toContainText('Average kg, 7-day rolling average');
	await expect(weighIns.getByRole('img', { name: 'Trend' })).toBeVisible();

	const list = row(page, 'List');
	await expect(list).toContainText('1 of 3');
	await expect(list).toContainText('Bought');
	await expect(list.getByRole('img', { name: '1 of 3' })).toBeVisible();

	await expect(row(page, 'Shops')).toContainText('2 rows');
	await expect(row(page, 'Shops').getByRole('img')).toHaveCount(0);
	await expect(row(page, 'Blank')).toContainText('Empty');

	if (!onPhone()) {
		await expect(weighIns).toContainText('Oct 28');
	}
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

	await weighIns.click();
	await expect(page.getByRole('heading', { name: 'Weigh-ins' })).toBeVisible();
});

test('the home stays home and marks the table left, which opens on its view', async ({
	page,
	context,
	account
}) => {
	void account;
	const { weighIns, curve } = await seedHome(context.request);
	await page.goto(tablePath(weighIns, curve));
	await expect(page.getByRole('img', { name: /per Date/u })).toBeVisible();

	await page.goto('/app');
	await expect(page).toHaveURL(/\/app$/u);
	const left = row(page, 'Weigh-ins');
	await expect(left).toHaveAttribute('aria-current', 'true');
	await expect(left).toContainText('Curve');
	await expect(row(page, 'List')).not.toHaveAttribute('aria-current', 'true');

	await left.click();
	await expect(page).toHaveURL(new RegExp(`${tablePath('Weigh-ins', 'Curve')}$`, 'u'));
	await expect(page.getByRole('img', { name: /per Date/u })).toBeVisible();
});

test('on a desk, the arrows walk the tables from the one left and Enter opens one', async ({
	page,
	context,
	account
}) => {
	test.skip(onPhone(), 'a keyboard and a fine pointer');
	void account;
	const { weighIns } = await seedHome(context.request);
	await page.goto(tablePath(weighIns));
	await expect(page.getByRole('heading', { name: 'Weigh-ins' })).toBeVisible();

	await page.goto('/app');
	await expect(row(page, 'Weigh-ins')).toBeFocused();
	await page.keyboard.press('ArrowDown');
	await expect(row(page, 'Blank')).toBeFocused();
	await page.keyboard.press('ArrowDown');
	await expect(row(page, 'List')).toBeFocused();
	await page.keyboard.press('ArrowUp');
	await page.keyboard.press('Enter');
	await expect(page.getByRole('heading', { name: 'Blank' })).toBeVisible();
});

test("a base's actions sit in its menu", async ({ page, context, account }) => {
	void account;
	await seedHome(context.request);
	await page.goto('/app');

	const band = page.locator('div').filter({ has: page.getByRole('heading', { name: 'Shopping' }) });
	await band.last().getByRole('button', { name: 'More' }).click();
	await page.getByRole('menuitem', { name: 'Delete' }).click();
	await expect(row(page, 'List')).toHaveCount(0);
	await toastButton(page, 'Undo').click();
	await expect(row(page, 'List')).toBeVisible();

	await band.last().getByRole('button', { name: 'More' }).click();
	await page.getByRole('menuitem', { name: 'Rename' }).click();
	const dialog = page.getByRole('dialog', { name: 'Rename base' });
	await dialog.getByRole('textbox').fill('Groceries');
	await dialog.getByRole('button', { name: 'Rename' }).click();
	await expect(page.getByRole('heading', { name: 'Groceries', level: 2 })).toBeVisible();
});

test('an empty home is one line and one row: name a table, or import a file', async ({
	page,
	account
}) => {
	void account;
	await page.goto('/app');
	await expect(
		page.getByText('No tables yet. Name one, drop a CSV here, or paste cells.')
	).toBeVisible();
	await expect(page.getByRole('textbox', { name: 'Table name' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'New table' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Import a file' })).toBeVisible();
	await expect(page.locator('main').getByRole('button')).toHaveCount(2);
	await expect(page.locator('main a[data-home-row]')).toHaveCount(0);
});

test('a double click on New table makes one table', async ({ page, context, account }) => {
	void account;
	const { weighIns } = await seedHome(context.request);
	await page.goto(tablePath(weighIns));
	await page.getByRole('link', { name: 'All tables' }).click();
	const rows = page.locator('main a[data-home-row]');
	await expect(rows).toHaveCount(4);
	await page.getByRole('button', { name: 'New table' }).dblclick();
	await expect(page.getByRole('textbox', { name: 'Table name' })).toBeFocused();
	await page.keyboard.press('Escape');
	await page.getByRole('link', { name: 'All tables' }).click();
	await expect(rows).toHaveCount(5);
});

test.describe('in fr-FR', () => {
	test.use({ locale: 'fr-FR' });

	test("a figure and its last entry read in the locale's own form", async ({
		page,
		context,
		account
	}) => {
		void account;
		await seedHome(context.request);
		await page.goto('/app');
		await expect(row(page, 'Weigh-ins')).toContainText('82,5');
		if (!onPhone()) {
			await expect(row(page, 'Weigh-ins')).toContainText('28 oct.');
		}
	});
});
