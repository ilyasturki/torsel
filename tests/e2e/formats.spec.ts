import fields from '../../src/lib/i18n/fields.ts';
import grid from '../../src/lib/i18n/grid.ts';
import names from '../../src/lib/i18n/names.ts';
import type { APIRequestContext } from '@playwright/test';

import { createBase, createTable, defaultViews, insertRows } from '../../src/lib/core/actions.ts';
import { columnMenu, expect, pick, seed, tablePath, test } from './harness.ts';

const FRENCH_MONTH =
	/^(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre) \d{4}$/u;

function seedWeighIns(request: APIRequestContext) {
	return seed(request, (ws, commit) => {
		const base = createBase(ws, 'Corps');
		commit(base.changes);
		const table = createTable(
			ws,
			base.id,
			'Pesées',
			[
				{ name: 'kg', type: 'number' },
				{ name: 'Date', type: 'date' },
				{ name: 'Prix', type: 'currency', currency: 'EUR' },
				{ name: 'Total', type: 'number' }
			],
			() => defaultViews(names.fr)
		);
		commit(table.changes);
		const [kg, date, price] = table.fieldIds;
		commit(insertRows(ws, table.id, [{ [kg]: 90.7, [date]: '2026-10-24', [price]: 10 }]).changes);
		return {
			grid: tablePath(table.id, table.viewIds[0]),
			entry: tablePath(table.id, table.viewIds[1])
		};
	});
}

test.describe('French system languages in a browser whose own locale is en-US', () => {
	test.use({ locale: 'en-US' });

	test.beforeEach(async ({ page }) => {
		await page.addInitScript(() => {
			Object.defineProperty(navigator, 'languages', { get: () => ['fr-FR'] });
			Object.defineProperty(navigator, 'language', { get: () => 'fr-FR' });
		});
	});

	test('numbers, dates, money, the calendar and the currency list follow French', async ({
		page,
		context,
		account
	}) => {
		void account;
		const weighIns = await seedWeighIns(context.request);
		await page.goto(weighIns.grid);
		expect(
			await page.evaluate(() => [
				new Intl.NumberFormat().resolvedOptions().locale,
				navigator.languages[0]
			])
		).toEqual(['en-US', 'fr-FR']);

		await expect(page.getByRole('gridcell', { name: '90,7', exact: true })).toBeVisible();
		await expect(page.getByRole('gridcell', { name: '24 oct.', exact: true })).toBeVisible();
		await expect(page.getByRole('gridcell', { name: /^10,00\s€$/u })).toBeVisible();

		await columnMenu(page, 'Total', grid.fr.fieldSettings);
		const sheet = page.getByRole('dialog', { name: fields.fr.field, exact: true });
		await pick(sheet.getByRole('combobox').first(), fields.fr.types.currency);
		await expect(sheet.getByRole('combobox', { name: fields.fr.currency })).toHaveValue(
			'euro (EUR)'
		);
		await page.keyboard.press('Escape');

		await page.goto(weighIns.entry);
		await page.getByLabel('Date', { exact: true }).click();
		const month = page.locator('[data-calendar] [role="group"]');
		await expect(month).toHaveAttribute('aria-label', FRENCH_MONTH);
		await expect(month.locator('span[aria-hidden="true"]').first()).toHaveText('lun');
	});
});
