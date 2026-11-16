import names from '../../src/lib/i18n/names.ts';
import type { APIRequestContext, Locator } from '@playwright/test';

import { createBase, createTable, defaultViews, insertRows } from '../../src/lib/core/actions.ts';
import { expect, newView, pick, seed, tableMenu, tablePath, test } from './harness.ts';

test.beforeEach(() => {
	test.skip(test.info().project.name !== 'phone', 'a phone-sized screen is the point here');
});

function seedSpending(request: APIRequestContext) {
	return seed(request, (ws, commit) => {
		const base = createBase(ws, 'Home');
		commit(base.changes);
		const spending = createTable(
			ws,
			base.id,
			'Spending',
			[
				{
					name: 'Category',
					type: 'choice',
					choices: [
						{ name: 'groceries', color: null },
						{ name: 'rent', color: null }
					]
				},
				{ name: 'Amount', type: 'number' },
				{ name: 'Count', type: 'number' },
				{ name: 'Note', type: 'text' },
				{ name: 'Shop', type: 'text' },
				{ name: 'Day', type: 'date' }
			],
			() => defaultViews(names.en)
		);
		commit(spending.changes);
		const [category, amount, count, note, shop, day] = spending.fieldIds;
		commit(
			insertRows(
				ws,
				spending.id,
				Array.from({ length: 12 }, (_, index) => ({
					[category]: index % 2 === 0 ? 'groceries' : 'rent',
					[amount]: 10 + index,
					[count]: index,
					[note]: `note ${index}`,
					[shop]: `shop ${index}`,
					[day]: `2026-10-${String(index + 10).padStart(2, '0')}`
				}))
			).changes
		);
		return { table: spending.id, entry: spending.viewIds[1] };
	});
}

/** Scrolls the nearest scrolling ancestor to its end, then says whether `field` sits wholly above `bar`. */
async function clearOf(field: Locator, bar: Locator): Promise<boolean> {
	await field.evaluate((node) => {
		let scroller = node.parentElement;
		while (scroller !== null && scroller.scrollHeight <= scroller.clientHeight) {
			scroller = scroller.parentElement;
		}
		scroller?.scrollTo(0, scroller.scrollHeight);
	});
	const [fieldBox, barBox] = await Promise.all([field.boundingBox(), bar.boundingBox()]);
	return (fieldBox?.y ?? 0) + (fieldBox?.height ?? 0) <= (barBox?.y ?? 0) + 0.5;
}

test('the last field scrolls clear of the button under it', async ({ page, context, account }) => {
	void account;
	const { table, entry } = await seedSpending(context.request);

	await page.goto(tablePath(table, entry));
	const addRow = page.getByRole('button', { name: 'Add row' });
	const day = page.locator('label').filter({ hasText: 'Day' }).locator('input');
	expect(await clearOf(day, addRow), 'Entry: Day above Add row').toBe(true);

	await page.goto(tablePath(table));
	await newView(page, 'Chart');
	await expect(page.getByRole('link', { name: 'Chart', exact: true })).toHaveAttribute(
		'aria-current',
		'page'
	);
	await tableMenu(page, 'View settings');
	const sheet = page.getByRole('dialog');
	await sheet.getByRole('button', { name: 'Line', exact: true }).click();
	await pick(sheet.getByRole('combobox', { name: 'Horizontal axis' }), 'Day');
	const last = sheet.getByRole('textbox', { name: 'Rolling average (days)' });
	expect(await clearOf(last, sheet.getByRole('button', { name: 'Delete' })), 'chart sheet').toBe(
		true
	);
	await sheet.getByRole('button', { name: 'Close' }).click();

	await page.goto('/app/settings');
	await page.getByRole('button', { name: 'Import' }).click();
	const header = Array.from({ length: 14 }, (_, index) => `column ${index + 1}`).join(',');
	const values = Array.from({ length: 14 }, (_, index) => String(index)).join(',');
	await page.getByLabel('File to import').setInputFiles({
		name: 'wide.csv',
		mimeType: 'text/csv',
		buffer: Buffer.from(`${header}\n${values}\n`)
	});
	const importSheet = page.getByRole('dialog', { name: 'Import' });
	const lastColumn = importSheet.getByRole('combobox', { name: 'Type of column 14' });
	expect(
		await clearOf(lastColumn, importSheet.getByRole('button', { name: 'Import' })),
		'import sheet'
	).toBe(true);
});

test('the keyboard stays down until a field is tapped', async ({ page, context, account }) => {
	void account;
	await seedSpending(context.request);

	await page.goto('/app/settings');
	await page.getByRole('button', { name: 'Import' }).click();
	const sheet = page.getByRole('dialog', { name: 'Import' });
	await expect(sheet).toBeFocused();
	await expect(sheet.getByRole('textbox', { name: 'File or link' })).not.toBeFocused();
	await sheet.getByRole('button', { name: 'Close' }).click();
});
