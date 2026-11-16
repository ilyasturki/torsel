import common from '../../src/lib/i18n/common.ts';
import grid from '../../src/lib/i18n/grid.ts';
import names from '../../src/lib/i18n/names.ts';
import views from '../../src/lib/i18n/views.ts';
import type { APIRequestContext, Locator, Page } from '@playwright/test';

import {
	createBase,
	createTable,
	createView,
	defaultViews,
	insertRows
} from '../../src/lib/core/actions.ts';
import type { Rec } from '../../src/lib/core/model.ts';
import { columnMenu, expect, seed, tablePath, test, toastButton, undo } from './harness.ts';

type Expenses = {
	path: string;
	table: string;
	price: string;
	paid: string;
	bought: string;
	time: string;
};

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
				{ name: 'Note', type: 'text' },
				{ name: 'Bought at', type: 'datetime' },
				{ name: 'Time', type: 'duration' }
			],
			() => defaultViews(names.en)
		);
		commit(table.changes);
		const [item, price, share, paid, , bought, time] = table.fieldIds;
		commit(
			insertRows(ws, table.id, [
				{ [item]: 'Coffee', [price]: 34, [share]: 10, [paid]: '2026-11-03', [time]: 5400 }
			]).changes
		);
		return { path: tablePath(table.id), table: table.id, price, paid, bought, time };
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

function isoDay(page: Page, shift: number): Promise<string> {
	return page.evaluate((by) => {
		const day = new Date();
		day.setDate(day.getDate() + by);
		const two = (n: number): string => String(n).padStart(2, '0');
		return `${day.getFullYear()}-${two(day.getMonth() + 1)}-${two(day.getDate())}`;
	}, shift);
}

async function press(page: Page, box: { x: number; y: number; width: number; height: number }) {
	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;
	if (onPhone()) await page.touchscreen.tap(x, y);
	else await page.mouse.click(x, y);
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
		const cross = await close.boundingBox();
		expect(cross).not.toBeNull();
		await press(page, cross!);

		await expect(question).toBeVisible();
		await expect(question.getByRole('button', { name: 'Keep editing' })).toBeFocused();
		const asked = await question.boundingBox();
		expect(asked && Math.abs(asked.y - (cross!.y + cross!.height))).toBeLessThan(24);
		expect(await close.boundingBox()).toEqual(cross);
		await expect(sheet.getByRole('button', { name: 'Add row' })).toBeVisible();

		await press(page, cross!);
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

	test('in another currency is named at once in the row sheet', async ({
		page,
		context,
		account
	}) => {
		void account;
		const { path } = await seedExpenses(context.request);
		await page.goto(path);

		await page.getByRole('button', { name: 'Add row' }).click();
		const sheet = page.getByRole('dialog');
		await sheet.getByLabel('Price').fill('$12');
		await expect(page.getByRole('status')).toContainText(grid.en.otherCurrency('euros'));
		await expect(sheet.getByLabel('Price')).toHaveAttribute('aria-invalid', 'true');
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
			void account;
			const { path, table, paid } = await seedExpenses(context.request);
			await page.goto(path);

			for (const [index, word] of words.entries()) {
				if (onPhone()) {
					const drawer = page.getByRole('dialog', { name: 'Paid on' });
					await at(page, 3).tap();
					await drawer.getByRole('textbox').fill(word);
					await drawer.getByRole('textbox').press('Enter');
					await expect(drawer).toHaveCount(0);
				} else {
					await at(page, 3).click();
					await page.keyboard.type(word);
					await page.keyboard.press('Enter');
				}
				await expect
					.poll(async () => (await stored(page, table))?.[paid], word)
					.toBe(await isoDay(page, [1, 0, -1][index]));
			}
		});
	});
}

test.describe('the today and now keys', () => {
	test('Ctrl+; puts today in a selected date cell and in its editor', async ({
		page,
		context,
		account
	}) => {
		void account;
		const { path, table, paid } = await seedExpenses(context.request);
		await page.goto(path);
		const today = await isoDay(page, 0);

		await at(page, 3).click();
		if (onPhone()) await page.keyboard.press('Escape');
		await page.keyboard.press('Control+;');
		await page.keyboard.press('Enter');
		await expect.poll(async () => (await stored(page, table))?.[paid]).toBe(today);

		await undo(page);
		await expect.poll(async () => (await stored(page, table))?.[paid]).toBe('2026-11-03');

		if (onPhone()) return;
		await at(page, 0).click();
		const editor = await openEditor(page, 3);
		await editor.press('Control+;');
		await editor.press('Enter');
		await expect.poll(async () => (await stored(page, table))?.[paid]).toBe(today);
	});

	test('Ctrl+Shift+; puts now in a date and time cell', async ({ page, context, account }) => {
		void account;
		const { path, table, bought } = await seedExpenses(context.request);
		await page.goto(path);
		const today = await isoDay(page, 0);

		await at(page, 5).scrollIntoViewIfNeeded();
		await at(page, 5).click();
		if (onPhone()) await page.keyboard.press('Escape');
		await page.keyboard.press('Control+Shift+;');
		await page.keyboard.press('Enter');
		await expect
			.poll(async () => String((await stored(page, table))?.[bought]))
			.toMatch(new RegExp(`^${today}T\\d{2}:\\d{2}$`, 'u'));
	});
});

type Words = { open: string; close: string; addRow: string };

const wordsOf = (locale: string): Words => {
	const lang = locale === 'fr-FR' ? 'fr' : 'en';
	return { open: grid[lang].openRow, close: common[lang].close, addRow: views[lang].addRow };
};

const calendar = (page: Page): Locator => page.locator('[data-calendar]');

async function openRow(page: Page, words = wordsOf('en-US')): Promise<Locator> {
	await page.getByRole('button', { name: words.open }).first().click();
	const sheet = page.getByRole('dialog', { name: 'Coffee' });
	await expect(sheet).toBeVisible();
	return sheet;
}

async function closeRow(sheet: Locator, words = wordsOf('en-US')): Promise<void> {
	await sheet.getByRole('button', { name: words.close }).click();
	await expect(sheet).toHaveCount(0);
}

/** The date editor of a field outside the grid: its calendar on desktop, its drawer on a phone. */
async function openDate(page: Page, scope: Locator, label: string): Promise<Locator> {
	await scope.getByLabel(label, { exact: true }).click();
	if (onPhone()) {
		const drawer = page.getByRole('dialog', { name: label });
		await expect(drawer).toBeVisible();
		return drawer;
	}
	await expect(calendar(page)).toBeVisible();
	return calendar(page);
}

function seedWeighIns(
	request: APIRequestContext
): Promise<{ path: string; table: string; day: string }> {
	return seed(request, (ws, commit) => {
		const base = createBase(ws, 'Body');
		commit(base.changes);
		const weight = createTable(
			ws,
			base.id,
			'Weight',
			[
				{ name: 'Date', type: 'date' },
				{ name: 'Kg', type: 'number' }
			],
			() => defaultViews(names.en)
		);
		commit(weight.changes);
		const entry = createView(ws, weight.id, { name: 'Log', type: 'entry', config: {} });
		commit(entry.changes);
		return { path: tablePath(weight.id, entry.id), table: weight.id, day: weight.fieldIds[0] };
	});
}

test.describe('the calendar', () => {
	test('sets a date in the grid, a day or a shortcut, and follows what is typed', async ({
		page,
		context,
		account
	}) => {
		void account;
		const { path, table, paid } = await seedExpenses(context.request);
		await page.goto(path);
		const drawer = page.getByRole('dialog', { name: 'Paid on' });

		if (onPhone()) {
			await at(page, 3).tap();
			await expect(drawer.locator('[data-day="2026-11-03"]')).toHaveAttribute(
				'aria-pressed',
				'true'
			);
			await drawer.locator('[data-day="2026-11-12"]').click();
			await expect(drawer).toHaveCount(0);
		} else {
			await openEditor(page, 3);
			await expect(calendar(page).locator('[data-day="2026-11-03"]')).toHaveAttribute(
				'aria-pressed',
				'true'
			);
			await calendar(page).locator('[data-day="2026-11-12"]').click();
			await expect(calendar(page)).toHaveCount(0);
		}
		await expect.poll(async () => (await stored(page, table))?.[paid]).toBe('2026-11-12');

		if (onPhone()) {
			await at(page, 3).tap();
			await drawer.getByRole('button', { name: 'Tomorrow' }).click();
		} else {
			await at(page, 0).click();
			const editor = await openEditor(page, 3);
			await editor.fill('Dec 25, 2026');
			await expect(calendar(page).locator('[data-day="2026-12-25"]')).toHaveAttribute(
				'aria-pressed',
				'true'
			);
			await calendar(page).getByRole('button', { name: 'Tomorrow' }).click();
		}
		await expect.poll(async () => (await stored(page, table))?.[paid]).toBe(await isoDay(page, 1));
	});

	test('in the row sheet, picks a day and Escape closes only the calendar', async ({
		page,
		context,
		account
	}) => {
		void account;
		const { path, table, paid } = await seedExpenses(context.request);
		await page.goto(path);
		const sheet = await openRow(page);

		const picker = await openDate(page, sheet, 'Paid on');
		await page.keyboard.press('Escape');
		await expect(picker).toHaveCount(0);
		await expect(sheet).toBeVisible();
		await expect(sheet.getByRole('alertdialog')).toHaveCount(0);

		const again = await openDate(page, sheet, 'Paid on');
		await again.getByRole('button', { name: 'Yesterday' }).click();
		await expect(again).toHaveCount(0);
		await expect(sheet).toBeVisible();
		await closeRow(sheet);
		await expect.poll(async () => (await stored(page, table))?.[paid]).toBe(await isoDay(page, -1));
	});

	test('in Entry, sets the day the row is logged on', async ({ page, context, account }) => {
		void account;
		const { path, table, day } = await seedWeighIns(context.request);
		await page.goto(path);

		const picker = await openDate(page, page.locator('main'), 'Date');
		await picker.getByRole('button', { name: 'Yesterday' }).click();
		await expect(picker).toHaveCount(0);
		await page.getByRole('button', { name: 'Add row' }).click();
		await expect.poll(async () => (await stored(page, table))?.[day]).toBe(await isoDay(page, -1));
	});
});

test.describe('the drawer', () => {
	test('closes on its backdrop and on a swipe down, the date untouched', async ({
		page,
		context,
		account
	}) => {
		test.skip(!onPhone(), 'a drawer is the phone form');
		void account;
		const { path, table, paid } = await seedExpenses(context.request);
		await page.goto(path);
		const drawer = page.getByRole('dialog', { name: 'Paid on' });

		await at(page, 3).tap();
		await expect(drawer).toBeVisible();
		await page.touchscreen.tap(195, 40);
		await expect(drawer).toHaveCount(0);

		await at(page, 3).tap();
		await expect(drawer).toBeVisible();
		const handle = await drawer.locator('[data-drawer-handle]').boundingBox();
		expect(handle).not.toBeNull();
		const x = handle!.x + handle!.width / 2;
		const y = handle!.y + handle!.height / 2;
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x, y + 240, { steps: 6 });
		await page.mouse.up();
		await expect(drawer).toHaveCount(0);
		expect((await stored(page, table))?.[paid]).toBe('2026-11-03');
	});
});

for (const { locale, word, shift } of [
	{ locale: 'en-US', word: 'tomorrow', shift: 1 },
	{ locale: 'fr-FR', word: 'hier', shift: -1 }
]) {
	test.describe(`day words and Ctrl+; outside the grid in ${locale}`, () => {
		test.use({ locale });
		const words = wordsOf(locale);

		test('the row sheet reads a day word and Ctrl+; puts today', async ({
			page,
			context,
			account
		}) => {
			void account;
			const { path, table, paid } = await seedExpenses(context.request);
			await page.goto(path);
			const sheet = await openRow(page, words);

			if (onPhone()) {
				const drawer = await openDate(page, sheet, 'Paid on');
				await drawer.getByRole('textbox').fill(word);
				await drawer.getByRole('textbox').press('Enter');
				await expect(drawer).toHaveCount(0);
			} else {
				await sheet.getByLabel('Paid on', { exact: true }).fill(word);
				await sheet.getByLabel('Note').click();
			}
			await closeRow(sheet, words);
			await expect
				.poll(async () => (await stored(page, table))?.[paid])
				.toBe(await isoDay(page, shift));

			const again = await openRow(page, words);
			if (onPhone()) {
				const drawer = await openDate(page, again, 'Paid on');
				await drawer.getByRole('textbox').press('Control+;');
				await expect(drawer).toHaveCount(0);
			} else {
				await again.getByLabel('Paid on', { exact: true }).press('Control+;');
				await again.getByLabel('Note').press('Control+;');
				await expect(again.getByLabel('Note')).not.toHaveValue('');
			}
			await closeRow(again, words);
			await expect
				.poll(async () => (await stored(page, table))?.[paid])
				.toBe(await isoDay(page, 0));
		});

		test('Entry reads a day word', async ({ page, context, account }) => {
			void account;
			const { path, table, day } = await seedWeighIns(context.request);
			await page.goto(path);

			if (onPhone()) {
				const drawer = await openDate(page, page.locator('main'), 'Date');
				await drawer.getByRole('textbox').fill(word);
				await drawer.getByRole('textbox').press('Enter');
				await expect(drawer).toHaveCount(0);
			} else {
				const date = page.getByLabel('Date', { exact: true });
				await date.clear();
				await expect(date).toHaveValue('');
				await date.pressSequentially(word);
				await expect(date).toHaveValue(word);
			}
			await page.getByRole('button', { name: words.addRow }).click();
			await expect
				.poll(async () => (await stored(page, table))?.[day])
				.toBe(await isoDay(page, shift));
		});
	});
}

test.describe('a duration', () => {
	test('steps five minutes with the arrows in the grid, or with − and + on a phone', async ({
		page,
		context,
		account
	}) => {
		void account;
		const { path, table, time } = await seedExpenses(context.request);
		await page.goto(path);

		if (onPhone()) {
			await at(page, 6).scrollIntoViewIfNeeded();
			await at(page, 6).tap();
			const drawer = page.getByRole('dialog', { name: 'Time' });
			await drawer.getByRole('button', { name: 'Time plus' }).click();
			await drawer.getByRole('button', { name: 'Time plus' }).click();
			await drawer.getByRole('button', { name: 'Time minus' }).click();
			await expect(drawer.getByRole('textbox')).toHaveValue('1:35');
			await page.keyboard.press('Escape');
			await expect(drawer).toHaveCount(0);
			await expect.poll(async () => (await stored(page, table))?.[time]).toBe(5700);
		} else {
			const editor = await openEditor(page, 6);
			await editor.press('ArrowUp');
			await expect(editor).toHaveValue('1:35');
			await editor.press('ArrowDown');
			await editor.press('ArrowDown');
			await expect(editor).toHaveValue('1:25');
			await editor.press('Enter');
			await expect.poll(async () => (await stored(page, table))?.[time]).toBe(5100);
		}
	});

	test('steps with − and + in the row sheet', async ({ page, context, account }) => {
		void account;
		const { path, table, time } = await seedExpenses(context.request);
		await page.goto(path);
		const sheet = await openRow(page);
		const field = sheet.getByLabel('Time', { exact: true });

		await sheet.getByRole('button', { name: 'Time minus' }).click();
		await expect(field).toHaveValue('1:25');
		await field.press('ArrowUp');
		await field.press('ArrowUp');
		await expect(field).toHaveValue('1:35');
		await closeRow(sheet);
		await expect.poll(async () => (await stored(page, table))?.[time]).toBe(5700);
	});
});

test.describe('a price pasted', () => {
	test('in another currency names the column currency and keeps the amount', async ({
		page,
		context,
		account
	}) => {
		void account;
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);
		const { path, table, price } = await seedExpenses(context.request);
		await page.goto(path);
		await page.evaluate(() => navigator.clipboard.writeText('$12'));

		await at(page, 1).click();
		if (onPhone()) await page.keyboard.press('Escape');
		await page.keyboard.press('Control+V');
		await expect(page.getByRole('status')).toContainText(grid.en.otherCurrency('euros'));
		expect((await stored(page, table))?.[price]).toBe(34);
	});

	test('filled over a range in another currency says so too', async ({
		page,
		context,
		account
	}) => {
		test.skip(onPhone(), 'Ctrl+Enter fills from a keyboard');
		void account;
		const { path, table, price } = await seedExpenses(context.request);
		await page.goto(path);

		await at(page, 1).click();
		await at(page, 2).click({ modifiers: ['Shift'] });
		await page.keyboard.type('$5');
		await page.keyboard.press('Control+Enter');
		await expect(page.getByRole('status')).toContainText(grid.en.otherCurrency('euros'));
		expect((await stored(page, table))?.[price]).toBe(34);
	});
});
