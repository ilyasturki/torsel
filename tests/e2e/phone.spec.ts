import type { APIRequestContext, Locator } from '@playwright/test';

import { createBase, createTable, insertRows } from '../../src/lib/core/actions.ts';
import { expect, seed, test } from './harness.ts';

test.beforeEach(() => {
	test.skip(test.info().project.name !== 'phone', 'a phone-sized screen is the point here');
});

function seedSpending(request: APIRequestContext) {
	return seed(request, (ws, commit) => {
		const base = createBase(ws, 'Home');
		commit(base.changes);
		const spending = createTable(ws, base.id, 'Spending', [
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
		]);
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

	await page.goto(`/app/t/${table}?v=${entry}`);
	const addRow = page.getByRole('button', { name: 'Add row' });
	const day = page.locator('label').filter({ hasText: 'Day' }).locator('input');
	expect(await clearOf(day, addRow), 'Entry: Day above Add row').toBe(true);

	await page.goto(`/app/t/${table}`);
	await page.getByRole('button', { name: 'More' }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'New view' }).click();
	const sheet = page.getByRole('dialog');
	await sheet.getByRole('button', { name: /^Chart/u }).click();
	await sheet.getByRole('button', { name: 'Line', exact: true }).click();
	await sheet.getByRole('combobox', { name: 'Horizontal axis' }).selectOption('Day');
	const last = sheet.getByRole('textbox', { name: 'Rolling average (days)' });
	expect(await clearOf(last, sheet.getByRole('button', { name: 'Create' })), 'chart sheet').toBe(
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

test('the keyboard stays down until a field is tapped, and the tabs make way for it', async ({
	page,
	context,
	account
}) => {
	void account;
	const { table, entry } = await seedSpending(context.request);

	await page.goto('/app/settings');
	await page.getByRole('button', { name: 'Import' }).click();
	const sheet = page.getByRole('dialog', { name: 'Import' });
	await expect(sheet).toBeFocused();
	await expect(sheet.getByRole('textbox', { name: 'Cells to import' })).not.toBeFocused();
	await sheet.getByRole('button', { name: 'Close' }).click();

	await page.goto(`/app/t/${table}?v=${entry}`);
	const tabs = page.getByRole('group', { name: 'Tables' });
	await expect(tabs).toBeVisible();
	const amount = page.getByRole('textbox', { name: 'Amount' });
	await amount.tap();
	await expect(tabs).toBeHidden();
	await page.getByRole('button', { name: 'groceries', exact: true }).tap();
	await expect(tabs).toBeVisible();

	// The keyboard shrinks the window as it opens; Back closes it and leaves the field focused.
	await amount.tap();
	await page.setViewportSize({ width: 390, height: 480 });
	await expect(tabs).toBeHidden();
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(amount).toBeFocused();
	await expect(tabs, 'no keyboard, so the tabs come back').toBeVisible();
	await page.setViewportSize({ width: 390, height: 480 });
	await expect(tabs, 'a tap on the focused field brings the keyboard back').toBeHidden();
});
