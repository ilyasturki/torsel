import fields from '../../src/lib/i18n/fields.ts';
import grid from '../../src/lib/i18n/grid.ts';
import names from '../../src/lib/i18n/names.ts';
import publish from '../../src/lib/i18n/publish.ts';
import type { APIRequestContext } from '@playwright/test';

import { createBase, createTable, defaultViews, insertRows } from '../../src/lib/core/actions.ts';
import { columnMenu, expect, pick, seed, tablePath, test } from './harness.ts';

const FRENCH_MONTH =
	/^(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre) \d{4}$/u;

function seedWeighIns(request: APIRequestContext, money = true) {
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
				{ name: 'Total', type: 'number' },
				...(money ? [{ name: 'Prix', type: 'currency' as const, currency: 'EUR' }] : [])
			],
			() => defaultViews(names.fr)
		);
		commit(table.changes);
		const [kg, date, , price] = table.fieldIds;
		const row = { [kg]: 90.7, [date]: '2026-10-24', ...(money ? { [price]: 10 } : {}) };
		commit(insertRows(ws, table.id, [row]).changes);
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

	test('numbers, dates, money and the calendar follow French', async ({
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

		await page.goto(weighIns.entry);
		await page.getByLabel('Date', { exact: true }).click();
		const month = page.locator('[data-calendar] [role="group"]');
		await expect(month).toHaveAttribute('aria-label', FRENCH_MONTH);
		await expect(month.locator('span[aria-hidden="true"]').first()).toHaveText('lun');
	});

	test('a first money field is in euros, among currencies named in French', async ({
		page,
		context,
		account
	}) => {
		void account;
		const weighIns = await seedWeighIns(context.request, false);
		await page.goto(weighIns.grid);
		await columnMenu(page, 'Total', grid.fr.fieldSettings);
		const sheet = page.getByRole('dialog', { name: fields.fr.field, exact: true });
		await pick(sheet.getByRole('combobox').first(), fields.fr.types.currency);
		const currency = sheet.getByRole('combobox', { name: fields.fr.currency });
		await expect(currency).toHaveValue('euro (EUR)');
		await currency.click();
		await expect(page.getByRole('option', { name: 'dollar des États-Unis (USD)' })).toBeVisible();
	});

	test('a published view follows French too', async ({ page, context, account }) => {
		void account;
		const weighIns = await seedWeighIns(context.request);
		await page.goto(weighIns.grid);
		await page.getByRole('button', { name: 'Plus', exact: true }).click();
		await page
			.getByRole('menuitem', { name: publish.fr.publish })
			.or(page.getByRole('dialog').getByRole('button', { name: publish.fr.publish }))
			.click();
		const dialog = page.getByRole('dialog', { name: publish.fr.publish });
		await dialog.getByRole('button', { name: publish.fr.publishNow, exact: true }).click();
		const link = dialog.getByRole('textbox', { name: publish.fr.link });
		await expect(link).toHaveValue(/\/v\/[\w-]{22}$/u);

		await page.goto(await link.inputValue());
		await expect(page.getByRole('gridcell', { name: '90,7', exact: true })).toBeVisible();
		await expect(page.getByRole('gridcell', { name: '24 oct.', exact: true })).toBeVisible();
	});
});
