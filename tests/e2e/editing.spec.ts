import grid from '../../src/lib/i18n/grid.ts';
import names from '../../src/lib/i18n/names.ts';
import type { APIRequestContext, Locator, Page } from '@playwright/test';

import { createBase, createTable, defaultViews, insertRows } from '../../src/lib/core/actions.ts';
import type { Rec } from '../../src/lib/core/model.ts';
import { columnMenu, expect, seed, tablePath, test, toastButton, undo } from './harness.ts';

type Expenses = { path: string; table: string; item: string; price: string; paid: string };

const onPhone = (): boolean => test.info().project.name === 'phone';

function seedExpenses(request: APIRequestContext): Promise<Expenses> {
	return seed(request, (ws, commit) => {
		const base = createBase(ws, 'Money');
		commit(base.changes);
		const table = createTable(
			ws,
			base.id,
			'Expenses',
			[
				{ name: 'Item', type: 'text' },
				{ name: 'Price', type: 'currency', currency: 'EUR' },
				{ name: 'Share', type: 'percent' },
				{ name: 'Paid on', type: 'date' },
				{ name: 'Note', type: 'text' }
			],
			() => defaultViews(names.en)
		);
		commit(table.changes);
		const [item, price, share, paid] = table.fieldIds;
		commit(
			insertRows(ws, table.id, [
				{ [item]: 'Coffee', [price]: 34, [share]: 10, [paid]: '2026-11-03' }
			]).changes
		);
		return { path: tablePath(table.id), table: table.id, item, price, paid };
	});
}

async function stored(page: Page, table: string): Promise<Rec['data'] | undefined> {
	const pull = await page.context().request.post('/api/sync', { data: { watermark: 0, push: [] } });
	const { records } = (await pull.json()) as { records: Rec[] };
	return records.find((rec) => rec.kind === 'row' && rec.parent === table && !rec.data._del)?.data;
}

function at(page: Page, column: number): Locator {
	return page.locator(`td[data-r="0"][data-c="${column}"]`);
}

/** Opens a cell's editor: a tap on a phone, Enter on the selected cell on a desktop. */
async function openEditor(page: Page, column: number): Promise<Locator> {
	const target = at(page, column);
	await target.scrollIntoViewIfNeeded();
	if (onPhone()) {
		await target.tap();
	} else {
		await target.click();
		await page.keyboard.press('Enter');
	}
	return target.locator('input');
}

function isoDay(shift: number): string {
	const day = new Date();
	day.setDate(day.getDate() + shift);
	const two = (n: number): string => String(n).padStart(2, '0');
	return `${day.getFullYear()}-${two(day.getMonth() + 1)}-${two(day.getDate())}`;
}

test.describe('the discard question', () => {
	test('sits by the X, keeps the footer, and a second X or Escape closes', async ({
		page,
		context,
		account
	}) => {
		void account;
		const { path } = await seedExpenses(context.request);
		await page.goto(path);

		const sheet = page.getByRole('dialog');
		const close = sheet.getByRole('button', { name: 'Close' });
		const question = sheet.getByRole('alertdialog', { name: 'Discard changes' });

		await page.getByRole('button', { name: 'Add row' }).click();
		await sheet.getByLabel('Note').fill('to the bakery');
		await close.click();

		await expect(question).toBeVisible();
		await expect(question.getByRole('button', { name: 'Keep editing' })).toBeFocused();
		const asked = await question.boundingBox();
		const cross = await close.boundingBox();
		expect(asked && cross && Math.abs(asked.y - (cross.y + cross.height))).toBeLessThan(24);
		await expect(sheet.getByRole('button', { name: 'Add row' })).toBeVisible();

		await close.click();
		await expect(sheet).toHaveCount(0);

		await page.getByRole('button', { name: 'Add row' }).click();
		await sheet.getByLabel('Note').fill('to the bakery');
		await page.keyboard.press('Escape');
		await expect(question).toBeVisible();
		await page.keyboard.press('Enter');
		await expect(question).toHaveCount(0);
		await expect(sheet.getByLabel('Note')).toHaveValue('to the bakery');
		await page.keyboard.press('Escape');
		await page.keyboard.press('Escape');
		await expect(sheet).toHaveCount(0);
	});
});

test.describe('field settings', () => {
	test('apply as they change, with Undo and no question', async ({ page, context, account }) => {
		void account;
		const { path } = await seedExpenses(context.request);
		await page.goto(path);

		await columnMenu(page, 'Note', 'Field settings');
		const sheet = page.getByRole('dialog', { name: 'Field' });
		await expect(sheet.getByRole('button', { name: 'Save' })).toHaveCount(0);
		await sheet.getByLabel('Name').fill('Shop');
		await sheet.getByRole('button', { name: 'Close' }).click();
		await expect(sheet).toHaveCount(0);
		await expect(page.getByRole('columnheader', { name: 'Shop', exact: true })).toBeVisible();

		await toastButton(page, 'Undo').click();
		await expect(page.getByRole('columnheader', { name: 'Note', exact: true })).toBeVisible();
	});
});

test.describe('a price', () => {
	test('opens on the bare amount, the sign beside it', async ({ page, context, account }) => {
		void account;
		const { path, table, price } = await seedExpenses(context.request);
		await page.goto(path);

		const editor = await openEditor(page, 1);
		await expect(editor).toHaveValue('34.00');
		await expect(at(page, 1).getByText('€', { exact: true })).toBeVisible();
		await editor.fill('35.5');
		await editor.press('Enter');
		await expect.poll(async () => (await stored(page, table))?.[price]).toBe(35.5);

		const share = await openEditor(page, 2);
		await expect(share).toHaveValue('10');
		await expect(at(page, 2).getByText('%', { exact: true })).toBeVisible();
	});

	test('in another currency is refused with the column currency named', async ({
		page,
		context,
		account
	}) => {
		void account;
		const { path, table, price } = await seedExpenses(context.request);
		await page.goto(path);

		const editor = await openEditor(page, 1);
		await editor.fill('$12');
		await editor.press('Enter');
		await expect(page.getByRole('status')).toContainText(grid.en.otherCurrency('euros'));
		await expect(editor).toBeVisible();
		await page.keyboard.press('Escape');
		expect((await stored(page, table))?.[price]).toBe(34);
	});

	test('a column made a currency takes the table currency', async ({ page, context, account }) => {
		void account;
		const { path } = await seedExpenses(context.request);
		await page.goto(path);

		await columnMenu(page, 'Note', 'Field settings');
		const sheet = page.getByRole('dialog', { name: 'Field' });
		await sheet.getByRole('combobox', { name: 'Type' }).click();
		await page.getByRole('option', { name: 'Currency', exact: true }).click();
		await expect(sheet.getByRole('combobox', { name: 'Currency' })).toHaveValue(/EUR/u);
		await sheet.getByRole('button', { name: 'Close' }).click();
		await expect(page.getByRole('columnheader', { name: 'Note', exact: true })).toBeVisible();
	});
});

test.describe('a price in fr-FR', () => {
	test.use({ locale: 'fr-FR' });

	test('opens bare with the sign after it, and names the euro', async ({
		page,
		context,
		account
	}) => {
		void account;
		const { path } = await seedExpenses(context.request);
		await page.goto(path);

		const editor = await openEditor(page, 1);
		await expect(editor).toHaveValue('34,00');
		await expect(at(page, 1).getByText('€', { exact: true })).toBeVisible();
		await editor.fill('12 $');
		await editor.press('Enter');
		await expect(page.getByRole('status')).toContainText(grid.fr.otherCurrency('euros'));
	});
});

for (const { locale, words } of [
	{ locale: 'en-US', words: ['tomorrow', 'today', 'yesterday'] },
	{ locale: 'fr-FR', words: ['demain', "aujourd'hui", 'hier'] }
]) {
	test.describe(`dates typed as words in ${locale}`, () => {
		test.use({ locale });

		test('a word for a day is read as that day', async ({ page, context, account }) => {
			test.skip(onPhone(), 'a tap on a date opens the date picker');
			void account;
			const { path, table, paid } = await seedExpenses(context.request);
			await page.goto(path);

			for (const [index, word] of words.entries()) {
				await at(page, 3).click();
				await page.keyboard.type(word);
				await page.keyboard.press('Enter');
				await expect
					.poll(async () => (await stored(page, table))?.[paid], word)
					.toBe(isoDay([1, 0, -1][index]));
			}
		});
	});
}

test.describe('the today key', () => {
	test('Ctrl+; writes today in a selected date cell and in its editor', async ({
		page,
		context,
		account
	}) => {
		void account;
		const { path, table, paid } = await seedExpenses(context.request);
		await page.goto(path);

		await at(page, 3).click();
		if (onPhone()) await page.keyboard.press('Escape');
		await page.keyboard.press('Control+;');
		await expect.poll(async () => (await stored(page, table))?.[paid]).toBe(isoDay(0));

		await undo(page);
		await expect.poll(async () => (await stored(page, table))?.[paid]).toBe('2026-11-03');
	});
});
