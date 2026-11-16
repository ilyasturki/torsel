import names from '../../src/lib/i18n/names.ts';
import type { APIRequestContext, Locator, Page } from '@playwright/test';

import {
	addField,
	createBase,
	createTable,
	defaultViews,
	insertRows
} from '../../src/lib/core/actions.ts';
import type { FieldSpec } from '../../src/lib/core/actions.ts';
import { toStored } from '../../src/lib/core/formula.ts';
import { columnMenu, expect, seed, tableMenu, tablePath, test, toastButton } from './harness.ts';

const LONG = 'A value far longer than any column could ever show on one line of a grid';

const desktopOnly = (why = 'a keyboard and a mouse belong to the desktop'): void => {
	test.skip(test.info().project.name === 'phone', why);
};

const isPhone = (): boolean => test.info().project.name === 'phone';

function seedEveryType(request: APIRequestContext) {
	return seed(request, (ws, commit) => {
		const base = createBase(ws, 'Gym');
		commit(base.changes);

		const target = createTable(ws, base.id, 'Exercises', [{ name: 'Name', type: 'text' }], () =>
			defaultViews(names.en)
		);
		commit(target.changes);
		const [targetRow] = (() => {
			const { ids, changes } = insertRows(ws, target.id, [{ [target.fieldIds[0]]: LONG }]);
			commit(changes);
			return ids;
		})();

		const specs: FieldSpec[] = [
			{ name: 'Text', type: 'text' },
			{ name: 'Number', type: 'number' },
			{ name: 'Date', type: 'date' },
			{ name: 'Choice', type: 'choice', choices: [{ name: LONG, color: null }] },
			{ name: 'Link', type: 'link', target: target.id },
			{ name: 'Check', type: 'check' }
		];
		const table = createTable(ws, base.id, 'Lifts', specs, () => defaultViews(names.en));
		commit(table.changes);
		const [text, number, date, choice, link] = table.fieldIds;
		commit(
			insertRows(ws, table.id, [
				{
					[text]: LONG,
					[number]: 1234567.25,
					[date]: '2026-10-30',
					[choice]: LONG,
					[link]: targetRow
				}
			]).changes
		);

		return { path: tablePath(table.id) };
	});
}

/** Lifts: Exercise (text), Kg (number), Style (choice), Done (check), Volume (formula). */
function seedLifts(request: APIRequestContext, count = 3) {
	return seed(request, (ws, commit) => {
		const base = createBase(ws, 'Gym');
		commit(base.changes);
		const table = createTable(
			ws,
			base.id,
			'Lifts',
			[
				{ name: 'Exercise', type: 'text' },
				{ name: 'Kg', type: 'number' },
				{
					name: 'Style',
					type: 'choice',
					choices: [
						{ name: 'Strict', color: 'blue' },
						{ name: 'Tempo', color: 'green' },
						{ name: 'Paused', color: 'orange' }
					]
				},
				{ name: 'Done', type: 'check' }
			],
			() => defaultViews(names.en)
		);
		commit(table.changes);
		const [exercise, kg, style] = table.fieldIds;
		const formula = addField(ws, table.id, {
			name: 'Volume',
			type: 'formula',
			expr: toStored('"Kg" * 2', ws.fields(table.id))
		});
		commit(formula.changes);
		commit(
			insertRows(
				ws,
				table.id,
				Array.from({ length: count }, (_, index) => ({
					[exercise]: `Exercise ${index + 1}`,
					[kg]: (index + 1) * 10,
					[style]: 'Strict'
				}))
			).changes
		);
		return { path: tablePath(table.id), fieldIds: table.fieldIds };
	});
}

function seedPlain(request: APIRequestContext, count: number) {
	return seed(request, (ws, commit) => {
		const base = createBase(ws, 'Gym');
		commit(base.changes);
		const table = createTable(
			ws,
			base.id,
			'Sets',
			[
				{ name: 'Name', type: 'text' },
				{ name: 'Reps', type: 'number' },
				{ name: 'Note', type: 'text' }
			],
			() => defaultViews(names.en)
		);
		commit(table.changes);
		const [name, reps, note] = table.fieldIds;
		commit(
			insertRows(
				ws,
				table.id,
				Array.from({ length: count }, (_, index) => ({
					[name]: `Row ${index + 1}`,
					[reps]: index + 1,
					[note]: index % 7 === 0 ? 'A somewhat longer note on this set' : 'Short'
				}))
			).changes
		);
		return { path: tablePath(table.id) };
	});
}

const at = (page: Page, row: number, col: number): Locator =>
	page.locator(`#grid-cell-${row}-${col}`);

const grid = (page: Page): Locator => page.getByRole('grid');

const selected = (page: Page): Locator => page.locator('td[aria-selected="true"]');

const editor = (page: Page): Locator => page.getByRole('gridcell').getByRole('textbox');

const columnWidths = (page: Page): Promise<number[]> =>
	page
		.locator('thead th')
		.evaluateAll((cells) => cells.map((cell) => cell.getBoundingClientRect().width));

const header = (page: Page, name: string): Locator =>
	page.getByRole('columnheader', { name, exact: true });

/** What a person's finger or mouse does first on a cell at this viewport. */
const press = (cell: Locator): Promise<void> => (isPhone() ? cell.tap() : cell.click());

async function open(page: Page, path: string): Promise<void> {
	await page.goto(path);
	await expect(grid(page)).toBeVisible();
	await page.evaluate(() => document.fonts.ready);
}

test.describe('cells', () => {
	test('arrow keys move the selected cell, and Home and End reach the row ends', async ({
		page,
		context,
		account
	}) => {
		desktopOnly();
		void account;
		await open(page, (await seedLifts(context.request)).path);

		await at(page, 0, 0).click();
		await expect(at(page, 0, 0)).toHaveAttribute('aria-selected', 'true');
		await expect(grid(page)).toBeFocused();

		await page.keyboard.press('ArrowRight');
		await expect(at(page, 0, 1)).toHaveAttribute('aria-selected', 'true');
		await page.keyboard.press('ArrowDown');
		await expect(at(page, 1, 1)).toHaveAttribute('aria-selected', 'true');
		await page.keyboard.press('ArrowLeft');
		await expect(at(page, 1, 0)).toHaveAttribute('aria-selected', 'true');
		await page.keyboard.press('ArrowUp');
		await expect(at(page, 0, 0)).toHaveAttribute('aria-selected', 'true');
		await expect(selected(page)).toHaveCount(1);

		await page.keyboard.press('End');
		await expect(at(page, 0, 4)).toHaveAttribute('aria-selected', 'true');
		await page.keyboard.press('Home');
		await expect(at(page, 0, 0)).toHaveAttribute('aria-selected', 'true');
		await expect(grid(page)).toHaveAttribute('aria-activedescendant', 'grid-cell-0-0');
	});

	test('typing replaces, Enter commits and moves down, Tab moves right, Escape cancels', async ({
		page,
		context,
		account
	}) => {
		desktopOnly();
		void account;
		await open(page, (await seedLifts(context.request)).path);

		await at(page, 0, 0).click();
		await page.keyboard.type('Squat');
		await expect(editor(page)).toHaveValue('Squat');
		await page.keyboard.press('Enter');
		await expect(at(page, 0, 0)).toHaveText('Squat');
		await expect(at(page, 1, 0)).toHaveAttribute('aria-selected', 'true');
		await expect(grid(page)).toBeFocused();

		await page.keyboard.type('Bench');
		await page.keyboard.press('Tab');
		await expect(at(page, 1, 0)).toHaveText('Bench');
		await expect(at(page, 1, 1)).toHaveAttribute('aria-selected', 'true');

		await page.keyboard.type('55');
		await page.keyboard.press('ArrowDown');
		await expect(at(page, 1, 1)).toHaveText('55');
		await expect(at(page, 2, 1)).toHaveAttribute('aria-selected', 'true');

		await page.keyboard.type('999');
		await page.keyboard.press('Escape');
		await expect(editor(page)).toHaveCount(0);
		await expect(at(page, 2, 1)).toHaveText('30');
		await expect(grid(page)).toBeFocused();
	});

	test('Enter edits what the cell holds, and a number above a thousand survives it', async ({
		page,
		context,
		account
	}) => {
		desktopOnly();
		void account;
		await open(page, (await seedEveryType(context.request)).path);

		await at(page, 0, 1).click();
		await page.keyboard.press('Enter');
		await expect(editor(page)).toHaveValue('1,234,567.25');
		await page.keyboard.press('Enter');
		await expect(at(page, 0, 1)).toHaveText('1,234,567.25');
		await expect(at(page, 1, 1)).toHaveAttribute('aria-selected', 'true');
	});

	test('what no number can be stays in the editor and says so', async ({
		page,
		context,
		account
	}) => {
		desktopOnly();
		void account;
		await open(page, (await seedLifts(context.request)).path);

		await at(page, 0, 1).click();
		await page.keyboard.type('heavy');
		await page.keyboard.press('Enter');
		await expect(page.getByRole('status')).toContainText(`"heavy" isn't a number`);
		await expect(editor(page)).toHaveValue('heavy');

		await page.keyboard.press('Escape');
		await expect(at(page, 0, 1)).toHaveText('10');
	});

	test('the editor sits exactly in the box of the cell', async ({ page, context, account }) => {
		void account;
		await open(page, (await seedEveryType(context.request)).path);

		for (const col of [0, 1, 2]) {
			const cell = at(page, 0, col);
			const closed = await cell.boundingBox();
			if (isPhone()) await cell.tap();
			else await cell.dblclick();
			const input = cell.locator('input');
			await expect(input).toBeFocused();
			const box = await cell.boundingBox();
			const inner = await input.boundingBox();
			expect(box?.width, 'opening an editor resizes nothing').toBe(closed?.width);
			expect(box?.height, 'opening an editor resizes nothing').toBe(closed?.height);
			expect(inner?.x).toBe(box?.x);
			expect(inner?.y).toBe(box?.y);
			expect(inner?.width).toBe(box?.width);
			expect(Math.abs((inner?.height ?? 0) - (box?.height ?? 0))).toBeLessThanOrEqual(1);
			await input.press('Escape');
		}
	});

	test('no click on a cell changes any column width', async ({ page, context, account }) => {
		void account;
		await open(page, (await seedEveryType(context.request)).path);

		await expect(at(page, 0, 0).getByText(LONG)).toBeVisible();
		const widths = await columnWidths(page);

		for (const [col, name] of ['text', 'number', 'date', 'choice', 'link', 'check'].entries()) {
			const cell = at(page, 0, col);
			await cell.dblclick();
			expect(await columnWidths(page), `editing the ${name} cell`).toEqual(widths);

			await page
				.getByRole('banner')
				.getByText(/^\d+ rows?$/u)
				.click();
			expect(await columnWidths(page), `leaving the ${name} cell`).toEqual(widths);
		}
	});

	test('a formula opens in place with names, says what is wrong, and changes the whole column', async ({
		page,
		context,
		account
	}) => {
		void account;
		await open(page, (await seedLifts(context.request)).path);

		const cell = at(page, 0, 4);
		await expect(cell).toHaveText('20');
		if (isPhone()) {
			await cell.tap();
		} else {
			await cell.dblclick();
		}
		const formula = page.getByRole('textbox', { name: 'Formula of Volume' });
		await expect(formula).toBeFocused();
		await expect(formula).toHaveValue('"Kg" * 2');
		await expect(page.getByText('Applies to the whole column')).toBeVisible();

		await formula.fill('"Kilos" * 3');
		await formula.press('Enter');
		await expect(page.getByRole('alert')).toHaveText('unknown field: "Kilos"');
		await expect(formula).toBeVisible();
		await expect(cell).toHaveText('20');

		await formula.fill('');
		await formula.pressSequentially('k');
		await expect(page.getByRole('option', { name: 'Kg' })).toBeVisible();
		await formula.press('Enter');
		await expect(formula).toHaveValue('"Kg"');
		await formula.pressSequentially(' * 3');
		await formula.press('Enter');
		await expect(formula).toHaveCount(0);
		await expect(cell).toHaveText('30');
		await expect(at(page, 2, 4)).toHaveText('90');

		if (!isPhone()) {
			await page.keyboard.press('Control+z');
			await expect(cell).toHaveText('20');
			await page.keyboard.press('Enter');
			await expect(formula).toHaveValue('"Kg" * 2');
			await formula.press('Escape');
			await expect(formula).toHaveCount(0);
			await expect(grid(page)).toBeFocused();
		}
	});

	test('a choice opens on the first click and filters by typing', async ({
		page,
		context,
		account
	}) => {
		void account;
		await open(page, (await seedLifts(context.request)).path);

		const cell = at(page, 0, 2);
		await press(cell);
		const list = page.getByRole('listbox', { name: 'Style' });
		await expect(list).toBeVisible();
		await expect(list.getByRole('option')).toHaveText(['Clear', 'Strict', 'Tempo', 'Paused']);

		await page.getByRole('combobox', { name: 'Style' }).fill('tem');
		await expect(list.getByRole('option')).toHaveText(['Tempo', 'Add "tem"']);
		await list.getByRole('option', { name: 'Tempo', exact: true }).click();
		await expect(list).toHaveCount(0);
		await expect(cell).toHaveText('Tempo');
	});

	test('a choice takes the keyboard: typing opens it filtered, Enter picks and moves down', async ({
		page,
		context,
		account
	}) => {
		desktopOnly();
		void account;
		await open(page, (await seedLifts(context.request)).path);

		await at(page, 0, 1).click();
		await page.keyboard.press('ArrowRight');
		await page.keyboard.type('pau');
		await expect(page.getByRole('combobox', { name: 'Style' })).toHaveValue('pau');
		await page.keyboard.press('Enter');
		await expect(at(page, 0, 2)).toHaveText('Paused');
		await expect(at(page, 1, 2)).toHaveAttribute('aria-selected', 'true');

		await page.keyboard.type('Drop set');
		await page.keyboard.press('Tab');
		await expect(at(page, 1, 2)).toHaveText('Drop set');
		await expect(at(page, 1, 3)).toHaveAttribute('aria-selected', 'true');
	});

	test('a check flips on one click, and on Space', async ({ page, context, account }) => {
		void account;
		await open(page, (await seedLifts(context.request)).path);

		const cell = at(page, 0, 3);
		await press(cell);
		await expect(cell.getByRole('img', { name: 'Yes' })).toBeVisible();
		if (!isPhone()) {
			await page.keyboard.press('Space');
			await expect(cell.getByRole('img', { name: 'Yes' })).toHaveCount(0);
		}
	});
});

test.describe('ranges', () => {
	test.beforeEach(() => desktopOnly());

	test('Shift and drag select a range, and Escape collapses it', async ({
		page,
		context,
		account
	}) => {
		void account;
		await open(page, (await seedLifts(context.request)).path);

		await at(page, 0, 0).click();
		await page.keyboard.press('Shift+ArrowDown');
		await page.keyboard.press('Shift+ArrowRight');
		await expect(selected(page)).toHaveCount(4);

		await page.keyboard.press('Escape');
		await expect(selected(page)).toHaveCount(1);

		await at(page, 2, 2).click({ modifiers: ['Shift'] });
		await expect(selected(page)).toHaveCount(4);

		await page.keyboard.press('Control+a');
		await expect(selected(page)).toHaveCount(15);

		await at(page, 0, 0).click();
		const from = await at(page, 0, 0).boundingBox();
		const to = await at(page, 2, 1).boundingBox();
		await page.mouse.move((from?.x ?? 0) + 5, (from?.y ?? 0) + 5);
		await page.mouse.down();
		await page.mouse.move((to?.x ?? 0) + 5, (to?.y ?? 0) + 5, { steps: 4 });
		await page.mouse.up();
		await expect(selected(page)).toHaveCount(6);
		await expect(editor(page)).toHaveCount(0);
	});

	test('Delete clears a range in one undo step, and leaves a formula alone', async ({
		page,
		context,
		account
	}) => {
		void account;
		await open(page, (await seedLifts(context.request)).path);

		await at(page, 0, 0).click();
		await at(page, 1, 1).click({ modifiers: ['Shift'] });
		await page.keyboard.press('Delete');
		await expect(at(page, 0, 0)).toHaveText('');
		await expect(at(page, 1, 1)).toHaveText('');
		await expect(at(page, 2, 0)).toHaveText('Exercise 3');
		await expect(at(page, 0, 4)).toHaveText('');

		await toastButton(page, 'Undo').click();
		await expect(at(page, 0, 0)).toHaveText('Exercise 1');
		await expect(at(page, 1, 1)).toHaveText('20');
		await expect(at(page, 0, 4)).toHaveText('20');
		await grid(page).press('Control+z');
		await expect(page.getByRole('status')).toContainText('Nothing to undo');
	});

	test('copies a range as TSV with the raw values', async ({ page, context, account }) => {
		void account;
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);
		await open(page, (await seedEveryType(context.request)).path);

		await at(page, 0, 1).click();
		await at(page, 0, 2).click({ modifiers: ['Shift'] });
		await page.keyboard.press('Control+C');

		await expect
			.poll(() => page.evaluate(() => navigator.clipboard.readText()))
			.toBe('1234567.25\t2026-10-30');
	});

	test('pastes TSV over cells, adds rows past the end, and undoes it all in one step', async ({
		page,
		context,
		account
	}) => {
		void account;
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);
		await open(page, (await seedLifts(context.request)).path);
		await expect(page.getByText('3 rows')).toBeVisible();

		const pasted =
			'Deadlift\t11,100.5\tTempo\nRow\t80\tNew style\nCurl\tnot a number\tStrict\nDip\t40\t';
		await page.evaluate((text) => navigator.clipboard.writeText(text), pasted);

		await at(page, 1, 0).click();
		await page.keyboard.press('Control+V');

		await expect(page.getByText('5 rows')).toBeVisible();
		await expect(page.getByRole('status')).toContainText('1 value');
		await expect(at(page, 1, 0)).toHaveText('Deadlift');
		await expect(at(page, 1, 1)).toHaveText('11,100.5');
		await expect(at(page, 1, 2)).toHaveText('Tempo');
		await expect(at(page, 2, 2)).toHaveText('New style');
		await expect(at(page, 3, 0)).toHaveText('Curl');
		await expect(at(page, 3, 1)).toHaveText('');
		await expect(at(page, 4, 0)).toHaveText('Dip');
		await expect(at(page, 4, 1)).toHaveText('40');
		await expect(selected(page)).toHaveCount(12);

		await grid(page).press('Control+z');
		await expect(page.getByText('3 rows')).toBeVisible();
		await expect(at(page, 1, 0)).toHaveText('Exercise 2');
		await expect(at(page, 1, 1)).toHaveText('20');
		await expect(at(page, 1, 2)).toHaveText('Strict');
		await grid(page).press('Control+z');
		await expect(page.getByRole('status')).toContainText('Nothing to undo');
	});

	test('one value pasted over a range fills it', async ({ page, context, account }) => {
		void account;
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);
		await open(page, (await seedLifts(context.request)).path);
		await page.evaluate(() => navigator.clipboard.writeText('42'));

		await at(page, 0, 1).click();
		await at(page, 2, 1).click({ modifiers: ['Shift'] });
		await page.keyboard.press('Control+V');

		for (const row of [0, 1, 2]) {
			await expect(at(page, row, 1)).toHaveText('42');
		}
	});
});

test.describe('new rows', () => {
	test('typing in the blank row creates the row where it was typed, and numbers stay put', async ({
		page,
		context,
		account
	}) => {
		desktopOnly();
		void account;
		await open(page, (await seedLifts(context.request)).path);
		const numbers = page.getByRole('rowheader').locator('button');
		await expect(numbers).toHaveText(['1', '2', '3', '']);

		const blank = await at(page, 3, 0).boundingBox();
		await at(page, 3, 0).click();
		await page.keyboard.type('Row four');
		await page.keyboard.press('Tab');

		await expect(page.getByText('4 rows')).toBeVisible();
		await expect(at(page, 3, 0)).toHaveText('Row four');
		expect(await at(page, 3, 0).boundingBox()).toEqual(blank);
		await expect(numbers).toHaveText(['1', '2', '3', '4', '']);
		await expect(at(page, 0, 0)).toHaveText('Exercise 1');
		await expect(at(page, 3, 1)).toHaveAttribute('aria-selected', 'true');

		await page.keyboard.type('44');
		await page.keyboard.press('Enter');
		await expect(at(page, 3, 1)).toHaveText('44');
		await expect(at(page, 4, 1)).toHaveAttribute('aria-selected', 'true');
		await expect(page.getByText('4 rows')).toBeVisible();

		await page.keyboard.type('55');
		await page.keyboard.press('Enter');
		await expect(page.getByText('5 rows')).toBeVisible();
		await expect(at(page, 4, 1)).toHaveText('55');
		await expect(at(page, 5, 1)).toHaveAttribute('aria-selected', 'true');
	});

	test('nothing typed makes no row', async ({ page, context, account }) => {
		desktopOnly();
		void account;
		await open(page, (await seedLifts(context.request)).path);

		await at(page, 3, 0).click();
		await page.keyboard.press('Enter');
		await page.keyboard.press('Enter');
		await at(page, 3, 1).click();
		await page.keyboard.type('5');
		await page.keyboard.press('Escape');
		await page.keyboard.press('Delete');
		await expect(page.getByText('3 rows')).toBeVisible();
	});

	test('a date in the blank row starts on today', async ({ page, context, account }) => {
		desktopOnly();
		void account;
		await open(page, (await seedEveryType(context.request)).path);
		const today = new Date().toLocaleDateString('en-US', {
			timeZone: 'UTC',
			month: 'short',
			day: 'numeric'
		});

		await at(page, 1, 2).click();
		await page.keyboard.press('Enter');
		await expect(editor(page)).toHaveValue(today);
		await page.keyboard.press('Escape');
		await expect(page.getByText('1 row', { exact: true })).toBeVisible();

		await at(page, 1, 0).click();
		await page.keyboard.type('Row two');
		await page.keyboard.press('Enter');
		await expect(page.getByText('2 rows')).toBeVisible();
		await at(page, 1, 2).click();
		await page.keyboard.press('Enter');
		await expect(editor(page)).toHaveValue(today);
	});

	test('New row takes you to the blank row of a long table', async ({ page, context, account }) => {
		desktopOnly('the phone adds through its menu, in a sheet');
		void account;
		await open(page, (await seedPlain(context.request, 300)).path);

		await page.getByRole('button', { name: 'New row' }).click();
		await expect(at(page, 300, 0)).toBeInViewport();
		await expect(grid(page)).toBeFocused();
		await page.keyboard.type('Row 301');
		await page.keyboard.press('Enter');
		await expect(page.getByText('301 rows')).toBeVisible();
		await expect(at(page, 300, 0)).toBeInViewport();
		await expect(at(page, 301, 0)).toBeInViewport();
	});

	test('a check in the blank row makes the row', async ({ page, context, account }) => {
		void account;
		await open(page, (await seedLifts(context.request)).path);

		await press(at(page, 3, 3));
		await expect(page.getByText('4 rows')).toBeVisible();
		await expect(at(page, 3, 3).getByRole('img', { name: 'Yes' })).toBeVisible();
	});
});

test.describe('columns', () => {
	test('the add-field head stands alone, with no empty column under it', async ({
		page,
		context,
		account
	}) => {
		void account;
		await open(page, (await seedPlain(context.request, 3)).path);
		await expect(page.getByRole('button', { name: 'Add a field' })).toBeVisible();
		await expect(page.locator('tbody tr').first().locator('td').last()).toHaveAttribute(
			'colspan',
			'2'
		);
	});

	test('start fitted to their content', async ({ page, context, account }) => {
		void account;
		await open(page, (await seedPlain(context.request, 50)).path);

		const name = (await header(page, 'Name').boundingBox())?.width ?? 0;
		const note = (await header(page, 'Note').boundingBox())?.width ?? 0;
		expect(note).toBeGreaterThan(name);
		const width = await at(page, 0, 2).evaluate((cell) => {
			const text = cell.querySelector('span');
			return text === null ? 0 : text.scrollWidth - text.clientWidth;
		});
		expect(width, 'a sampled value is not cut off').toBeLessThanOrEqual(0);
	});

	test('a long value truncates inside its column', async ({ page, context, account }) => {
		void account;
		await open(page, (await seedEveryType(context.request)).path);

		const cell = at(page, 0, 0);
		await expect(cell.getByText(LONG)).toBeVisible();
		const box = await cell.boundingBox();
		expect(box?.width).toBeLessThanOrEqual(320);
		const clipped = await cell
			.getByText(LONG)
			.evaluate((text) => text.scrollWidth > text.clientWidth);
		expect(clipped).toBe(true);
	});

	test('the add-field column stays reachable when the fields outgrow the screen', async ({
		page,
		context,
		account
	}) => {
		void account;
		await open(page, (await seedEveryType(context.request)).path);

		const add = page.getByRole('button', { name: 'Add a field' });
		const column = await page.locator('thead th').filter({ has: add }).boundingBox();
		expect(column?.width).toBe(44);

		await add.click();
		await expect(page.getByRole('dialog')).toBeVisible();
	});

	test('drag to resize, double-click to refit, and a width survives a reload', async ({
		page,
		context,
		account
	}) => {
		desktopOnly('a column handle needs a mouse');
		void account;
		await open(page, (await seedPlain(context.request, 5)).path);

		const fitted = (await header(page, 'Name').boundingBox())?.width ?? 0;
		const handle = header(page, 'Name').locator('div[aria-hidden="true"]');
		const box = await handle.boundingBox();
		await page.mouse.move((box?.x ?? 0) + 2, (box?.y ?? 0) + 5);
		await page.mouse.down();
		await page.mouse.move((box?.x ?? 0) + 102, (box?.y ?? 0) + 5, { steps: 4 });
		await page.mouse.up();
		await expect
			.poll(async () => (await header(page, 'Name').boundingBox())?.width)
			.toBe(fitted + 100);
		await expect(page.getByRole('dialog')).toHaveCount(0);

		await expect(page.getByRole('status')).toHaveCount(0);
		await page.waitForFunction(async () => {
			const databases = await indexedDB.databases();
			return databases.length > 0;
		});
		await page.reload();
		await expect(grid(page)).toBeVisible();
		await expect
			.poll(async () => (await header(page, 'Name').boundingBox())?.width)
			.toBe(fitted + 100);

		await handle.dblclick();
		await expect.poll(async () => (await header(page, 'Name').boundingBox())?.width).toBe(fitted);
	});

	test('a drag reorders fields, and a click moves nothing', async ({ page, context, account }) => {
		desktopOnly('a drag on a phone scrolls');
		void account;
		await open(page, (await seedPlain(context.request, 5)).path);
		const names = page.locator('thead th[scope="col"]');
		await expect(names).toHaveText(['Name', 'Reps', 'Note']);

		const reps = await header(page, 'Reps').boundingBox();
		await header(page, 'Reps').getByRole('button').click();
		await page.keyboard.press('Escape');
		await expect(names).toHaveText(['Name', 'Reps', 'Note']);
		await expect(page.getByRole('menuitem', { name: 'Sort ascending' })).toHaveCount(0);

		const note = await header(page, 'Note').boundingBox();
		await page.mouse.move((reps?.x ?? 0) + 10, (reps?.y ?? 0) + 10);
		await page.mouse.down();
		await page.mouse.move((note?.x ?? 0) + (note?.width ?? 0) - 2, (note?.y ?? 0) + 10, {
			steps: 6
		});
		await page.mouse.up();
		await expect(names).toHaveText(['Name', 'Note', 'Reps']);
		await expect(at(page, 0, 2)).toHaveText('1');
		await expect(page.getByRole('menuitem', { name: 'Sort ascending' })).toHaveCount(0);

		await page.reload();
		await expect(names).toHaveText(['Name', 'Note', 'Reps']);
	});

	test('header and first column stay in place while the rest scrolls', async ({
		page,
		context,
		account
	}) => {
		void account;
		await page.setViewportSize({ width: 390, height: 844 });
		await open(page, (await seedEveryType(context.request)).path);
		await expect(at(page, 0, 0).getByText(LONG)).toBeVisible();

		const frozen = at(page, 0, 0);
		const moving = at(page, 0, 3);
		const [frozenBefore, movingBefore] = [await frozen.boundingBox(), await moving.boundingBox()];

		await grid(page)
			.locator('xpath=ancestor::div[contains(@class,"overflow-auto")][1]')
			.evaluate((scroller) => {
				scroller.scrollLeft = 300;
			});
		await expect
			.poll(async () => (await moving.boundingBox())?.x)
			.toBeLessThan(movingBefore?.x ?? 0);
		expect((await frozen.boundingBox())?.x).toBe(frozenBefore?.x);
		await expect(header(page, 'Text')).toBeInViewport();
	});

	test('the header stays on top of a long table', async ({ page, context, account }) => {
		void account;
		await open(page, (await seedPlain(context.request, 60)).path);
		const before = await header(page, 'Name').boundingBox();

		await grid(page)
			.locator('xpath=ancestor::div[contains(@class,"overflow-auto")][1]')
			.evaluate((scroller) => {
				scroller.scrollTop = 800;
			});
		await expect(at(page, 0, 0)).not.toBeInViewport();
		expect((await header(page, 'Name').boundingBox())?.y).toBe(before?.y);
	});
});

test.describe('scale', () => {
	const scroller = (page: Page): Locator =>
		grid(page).locator('xpath=ancestor::div[contains(@class,"overflow-auto")][1]');

	test('a 380-row import renders a window and reaches its last row', async ({
		page,
		context,
		account
	}) => {
		void account;
		await open(page, (await seedPlain(context.request, 380)).path);
		await expect(page.getByText('380 rows')).toBeVisible();

		const rendered = await page.locator('tbody tr').count();
		expect(rendered).toBeLessThan(120);

		const frames = await scroller(page).evaluate(async (element) => {
			const seen: number[] = [];
			let last = performance.now();
			const height = element.scrollHeight - element.clientHeight;
			for (let step = 0; step <= 60; step += 1) {
				element.scrollTop = (height * step) / 60;
				await new Promise((resolve) => requestAnimationFrame(resolve));
				const now = performance.now();
				seen.push(now - last);
				last = now;
			}
			return seen;
		});
		const sorted = frames.toSorted((a, b) => a - b);
		const typical = sorted[Math.floor(sorted.length / 2)];
		expect(typical, 'the median frame while scrolling, ms').toBeLessThan(100);

		await expect(at(page, 379, 0)).toHaveText('Row 380');
		await expect(at(page, 380, 0)).toBeAttached();
		expect(await page.locator('tbody tr').count()).toBeLessThan(120);
	});

	test('a right click far down keeps the place and opens the row menu there', async ({
		page,
		context,
		account
	}) => {
		desktopOnly();
		void account;
		await open(page, (await seedPlain(context.request, 200)).path);
		await scroller(page).evaluate((element) => (element.scrollTop = element.scrollHeight));
		const target = at(page, 198, 1);
		await expect(target).toHaveText('199');

		await target.click({ button: 'right' });
		await expect(page.getByRole('menuitem', { name: 'Insert row below' })).toBeVisible();
		await expect(target).toHaveAttribute('aria-selected', 'true');
		expect(await scroller(page).evaluate((element) => element.scrollTop)).toBeGreaterThan(1000);
	});

	test('10,000 rows stay usable from the first row to the last', async ({
		page,
		context,
		account
	}) => {
		test.slow();
		void account;
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);
		await open(page, (await seedPlain(context.request, 10_000)).path);
		await expect(page.getByText('10000 rows')).toBeVisible();
		expect(await page.locator('tbody tr').count()).toBeLessThan(120);
		await expect(at(page, 0, 0)).toHaveText('Row 1');

		await scroller(page).evaluate(async (element) => {
			const height = element.scrollHeight - element.clientHeight;
			for (let step = 0; step <= 20; step += 1) {
				element.scrollTop = (height * step) / 20;
				await new Promise((resolve) => requestAnimationFrame(resolve));
			}
		});
		await expect(at(page, 9999, 0)).toHaveText('Row 10000');
		expect(await page.locator('tbody tr').count()).toBeLessThan(120);

		await scroller(page).evaluate((element) => {
			element.scrollTop = 0;
		});
		await expect(at(page, 0, 0)).toHaveText('Row 1');

		if (isPhone()) {
			await at(page, 0, 1).tap();
			await expect(editor(page)).toBeFocused();
			await editor(page).fill('7');
			await editor(page).press('Enter');
			await expect(at(page, 0, 1)).toHaveText('7');
			return;
		}

		await at(page, 0, 0).click();
		await page.keyboard.press('Control+End');
		await expect(at(page, 9999, 2)).toBeInViewport();
		await page.keyboard.press('Home');
		await page.keyboard.press('ArrowDown');
		await expect(at(page, 10000, 0)).toBeInViewport();

		const started = Date.now();
		await page.keyboard.type('Row 10001');
		await page.keyboard.press('Enter');
		await expect(page.getByText('10001 rows')).toBeVisible();
		await expect(at(page, 10000, 0)).toHaveText('Row 10001');
		expect(Date.now() - started, 'typing a row at the end, ms').toBeLessThan(15_000);

		await at(page, 10000, 1).click();
		await page.keyboard.type('12');
		await page.keyboard.press('ArrowUp');
		await expect(at(page, 10000, 1)).toHaveText('12');
		await expect(at(page, 9999, 1)).toHaveAttribute('aria-selected', 'true');

		await page.evaluate(() => navigator.clipboard.writeText('1\ta\n2\tb\n3\tc'));
		await page.keyboard.press('Control+V');
		await expect(page.getByText('10002 rows')).toBeVisible();
		await expect(at(page, 10001, 1)).toHaveText('3');

		await page.keyboard.press('Control+z');
		await expect(page.getByText('10001 rows')).toBeVisible();

		await columnMenu(page, 'Reps', 'Sort descending');
		await expect(at(page, 0, 1)).toHaveText('10,000');
	});
});

test.describe('sorting', () => {
	test('sorts from the header and clears it', async ({ page, context, account }) => {
		void account;
		await open(page, (await seedPlain(context.request, 5)).path);
		const reps = header(page, 'Reps');
		await expect(at(page, 0, 1)).toHaveText('1');

		await columnMenu(page, 'Reps', 'Sort descending');
		await expect(at(page, 0, 1)).toHaveText('5');
		await expect(reps).toHaveAttribute('aria-sort', 'descending');

		await page.reload();
		await expect(at(page, 0, 1)).toHaveText('5');

		await columnMenu(page, 'Reps', 'Clear sort');
		await expect(at(page, 0, 1)).toHaveText('1');
		await expect(reps).not.toHaveAttribute('aria-sort', /./u);
	});

	test('blank values stay last whichever way it sorts', async ({ page, context, account }) => {
		void account;
		await open(page, (await seedLifts(context.request)).path);

		await at(page, 0, 1).dblclick();
		await editor(page).fill('');
		await editor(page).press('Enter');
		await expect(at(page, 0, 1)).toHaveText('');

		await columnMenu(page, 'Kg', 'Sort ascending');
		await expect(at(page, 2, 1)).toHaveText('');
		await columnMenu(page, 'Kg', 'Sort descending');
		await expect(at(page, 0, 1)).toHaveText('30');
		await expect(at(page, 2, 1)).toHaveText('');
	});

	test('filters by a field and clears it', async ({ page, context, account }) => {
		void account;
		await open(page, (await seedPlain(context.request, 30)).path);

		await header(page, 'Name').getByRole('button').click();
		await page.getByRole('textbox', { name: 'Filter Name' }).fill('row 2');
		await page.keyboard.press('Enter');

		await expect(page.getByText('Name contains "row 2": 11 of 30')).toBeVisible();
		await expect(at(page, 0, 0)).toHaveText('Row 2');
		await expect(at(page, 1, 0)).toHaveText('Row 20');

		await page.reload();
		await expect(page.getByText('Name contains "row 2": 11 of 30')).toBeVisible();

		await page.getByRole('button', { name: 'Clear filter' }).click();
		await expect(at(page, 1, 0)).toHaveText('Row 2');
		await expect(page.getByRole('button', { name: 'Clear filter' })).toHaveCount(0);
	});
});

test.describe('phone', () => {
	test.beforeEach(() => {
		test.skip(!isPhone(), 'a thumb is the point here');
	});

	test('a tap edits in a control sized for a thumb, and scrolling leaves the first column', async ({
		page,
		context,
		account
	}) => {
		void account;
		await open(page, (await seedEveryType(context.request)).path);

		const sticky = await at(page, 0, 0).boundingBox();
		expect(sticky?.width, 'the first column leaves room for the rest').toBeLessThan(160);

		const reps = at(page, 0, 1);
		await reps.tap();
		const input = reps.locator('input');
		await expect(input).toBeFocused();
		expect((await input.boundingBox())?.height).toBeGreaterThanOrEqual(43);
		await expect(input).toHaveAttribute('inputmode', 'decimal');
		await input.fill('12');
		await input.press('Enter');
		await expect(reps).toHaveText('12');

		const date = at(page, 0, 2);
		await date.scrollIntoViewIfNeeded();
		await date.tap();
		await expect(date.locator('input')).toHaveAttribute('type', 'date');
		await date.locator('input').press('Escape');
	});

	test('one tap on a date opens the picker', async ({ page, context, account }) => {
		void account;
		await page.addInitScript(() => {
			const counted = window as unknown as { pickers: number };
			counted.pickers = 0;
			HTMLInputElement.prototype.showPicker = function () {
				counted.pickers += 1;
			};
		});
		await open(page, (await seedEveryType(context.request)).path);

		const date = at(page, 0, 2);
		await date.scrollIntoViewIfNeeded();
		await date.tap();
		await expect(date.locator('input')).toHaveAttribute('type', 'date');
		expect(await page.evaluate(() => (window as unknown as { pickers: number }).pickers)).toBe(1);
	});

	test('Enter in a number moves down the column with the same keyboard', async ({
		page,
		context,
		account
	}) => {
		void account;
		await open(page, (await seedLifts(context.request)).path);

		await at(page, 0, 1).tap();
		for (const [index, kg] of ['60', '62.5'].entries()) {
			const input = at(page, index, 1).locator('input');
			await expect(input).toBeFocused();
			await expect(input).toHaveAttribute('inputmode', 'decimal');
			await input.fill(kg);
			await input.press('Enter');
			await expect(at(page, index, 1)).toHaveText(kg);
		}
		const last = at(page, 2, 1).locator('input');
		await expect(last).toBeFocused();
		await last.press('Enter');
		await expect(page.getByRole('gridcell').locator('input')).toHaveCount(0);
		expect(
			await page.evaluate(() => document.activeElement?.tagName),
			'off the last row the keyboard goes away'
		).toBe('BODY');
	});

	test('a choice offers options big enough to tap', async ({ page, context, account }) => {
		void account;
		await open(page, (await seedLifts(context.request)).path);

		await at(page, 0, 2).tap();
		const option = page.getByRole('option', { name: 'Tempo', exact: true });
		await expect(option).toBeVisible();
		expect((await option.boundingBox())?.height).toBeGreaterThanOrEqual(44);
		await expect(page.getByRole('combobox', { name: 'Style' })).toHaveAttribute(
			'inputmode',
			'none'
		);
		await option.tap();
		await expect(at(page, 0, 2)).toHaveText('Tempo');
	});

	test('a tap in the blank row makes a row', async ({ page, context, account }) => {
		void account;
		await open(page, (await seedLifts(context.request)).path);

		const blank = at(page, 3, 0);
		await blank.tap();
		await blank.locator('input').fill('Row four');
		await blank.locator('input').press('Enter');
		await expect(page.getByText('4 rows')).toBeVisible();
		await expect(at(page, 3, 0)).toHaveText('Row four');
		await expect(at(page, 4, 0).locator('input')).toHaveCount(0);
	});
});

/** Plan: Day (date), N (number), Name (text); values in the first two of six rows only. */
function seedSeries(request: APIRequestContext) {
	return seed(request, (ws, commit) => {
		const base = createBase(ws, 'Gym');
		commit(base.changes);
		const table = createTable(
			ws,
			base.id,
			'Plan',
			[
				{ name: 'Day', type: 'date' },
				{ name: 'N', type: 'number' },
				{ name: 'Name', type: 'text' }
			],
			() => defaultViews(names.en)
		);
		commit(table.changes);
		const [day, n, name] = table.fieldIds;
		commit(
			insertRows(ws, table.id, [
				{ [day]: '2024-11-04', [n]: 1, [name]: 'Set 1' },
				{ [day]: '2024-11-11', [n]: 2 },
				{},
				{},
				{},
				{}
			]).changes
		);
		return { path: tablePath(table.id) };
	});
}

async function dragFill(page: Page, from: Locator, to: Locator): Promise<void> {
	const handle = from.locator('.cursor-crosshair');
	const start = await handle.boundingBox();
	const end = await to.boundingBox();
	await page.mouse.move((start?.x ?? 0) + 3, (start?.y ?? 0) + 3);
	await page.mouse.down();
	await page.mouse.move((end?.x ?? 0) + 10, (end?.y ?? 0) + 10, { steps: 6 });
	await page.mouse.up();
}

const column = (page: Page, col: number, count: number): Promise<string[]> =>
	Promise.all(Array.from({ length: count }, (_, row) => at(page, row, col).innerText()));

test.describe('filling', () => {
	test('the handle copies one value and continues a series, each in one undo step', async ({
		page,
		context,
		account
	}) => {
		desktopOnly('the handle is for a mouse');
		void account;
		await open(page, (await seedSeries(context.request)).path);

		await at(page, 0, 1).click();
		await dragFill(page, at(page, 0, 1), at(page, 2, 1));
		await expect.poll(() => column(page, 1, 4)).toEqual(['1', '1', '1', '']);
		await expect(page.getByRole('status')).toContainText('Filled 2 cells');
		await page.keyboard.press('Control+z');
		await expect.poll(() => column(page, 1, 4)).toEqual(['1', '2', '', '']);

		await at(page, 0, 0).click();
		await at(page, 1, 1).click({ modifiers: ['Shift'] });
		await dragFill(page, at(page, 1, 1), at(page, 4, 1));
		await expect.poll(() => column(page, 1, 6)).toEqual(['1', '2', '3', '4', '5', '']);
		await expect
			.poll(() => column(page, 0, 5))
			.toEqual(['Nov 4, 2024', 'Nov 11, 2024', 'Nov 18, 2024', 'Nov 25, 2024', 'Dec 2, 2024']);
		await expect(selected(page)).toHaveCount(10);

		await page.keyboard.press('Control+z');
		await expect.poll(() => column(page, 1, 4)).toEqual(['1', '2', '', '']);
		await expect(at(page, 2, 0)).toHaveText('');
	});

	test('Ctrl+D and Ctrl+R copy the first row down and the first column across', async ({
		page,
		context,
		account
	}) => {
		desktopOnly();
		void account;
		await open(page, (await seedSeries(context.request)).path);

		await at(page, 0, 1).click();
		await at(page, 3, 1).click({ modifiers: ['Shift'] });
		await page.keyboard.press('Control+d');
		await expect.poll(() => column(page, 1, 5)).toEqual(['1', '1', '1', '1', '']);

		await at(page, 4, 1).click();
		await page.keyboard.press('Control+d');
		await expect(at(page, 4, 1)).toHaveText('1');

		await at(page, 0, 2).click();
		await page.keyboard.press('Control+z');
		await page.keyboard.press('Control+z');
		await expect.poll(() => column(page, 1, 3)).toEqual(['1', '2', '']);

		await at(page, 1, 1).click();
		await at(page, 1, 2).click({ modifiers: ['Shift'] });
		await page.keyboard.press('Control+r');
		await expect(at(page, 1, 2)).toHaveText('2');
	});

	test('a phone shows no fill handle', async ({ page, context, account }) => {
		test.skip(!isPhone(), 'the handle needs a mouse');
		void account;
		await open(page, (await seedSeries(context.request)).path);
		await at(page, 0, 1).tap();
		await page.getByRole('gridcell').getByRole('textbox').press('Escape');
		await expect(at(page, 0, 1).locator('.cursor-crosshair')).toBeHidden();
	});
});

test.describe('columns, by hand', () => {
	test('fit all resets every width, from a column menu and the table menu', async ({
		page,
		context,
		account
	}) => {
		desktopOnly('a resize handle is for a mouse');
		void account;
		await open(page, (await seedPlain(context.request, 3)).path);
		const width = async (name: string): Promise<number> =>
			(await header(page, name).boundingBox())?.width ?? 0;
		const fitted = await width('Name');

		const widen = async (): Promise<void> => {
			const box = await header(page, 'Name').locator('div[aria-hidden="true"]').boundingBox();
			await page.mouse.move((box?.x ?? 0) + 1, (box?.y ?? 0) + 5);
			await page.mouse.down();
			await page.mouse.move((box?.x ?? 0) + 120, (box?.y ?? 0) + 5, { steps: 4 });
			await page.mouse.up();
			await expect.poll(() => width('Name')).toBeGreaterThan(fitted + 100);
		};

		await widen();
		await columnMenu(page, 'Reps', 'Fit all columns');
		await expect.poll(() => width('Name')).toBe(fitted);
		await page.keyboard.press('Control+z');
		await expect.poll(() => width('Name')).toBeGreaterThan(fitted + 100);

		await tableMenu(page, 'Fit all columns');
		await expect.poll(() => width('Name')).toBe(fitted);
		await page.reload();
		await expect.poll(() => width('Name')).toBe(fitted);
	});

	test('the keyboard widens and narrows the selected column', async ({
		page,
		context,
		account
	}) => {
		desktopOnly();
		void account;
		await open(page, (await seedPlain(context.request, 3)).path);
		const width = async (): Promise<number> =>
			Math.round((await header(page, 'Name').boundingBox())?.width ?? 0);
		const fitted = await width();

		await at(page, 0, 0).click();
		await page.keyboard.press('Alt+Shift+ArrowRight');
		await page.keyboard.press('Alt+Shift+ArrowRight');
		await expect.poll(width).toBe(fitted + 32);
		await page.keyboard.press('Alt+Shift+ArrowLeft');
		await expect.poll(width).toBe(fitted + 16);
		await expect(at(page, 0, 0)).toHaveAttribute('aria-selected', 'true');
		await page.keyboard.press('Control+z');
		await expect.poll(width).toBe(fitted + 32);

		await header(page, 'Name').locator('div[aria-hidden="true"]').hover();
		await expect(page.getByRole('tooltip')).toHaveText(/Alt\+Shift\+← Alt\+Shift\+→/u);
	});

	test('a saved width gives way to the fit on a phone too', async ({ page, context, account }) => {
		test.skip(!isPhone(), 'the desktop resizes by hand above');
		void account;
		const { path } = await seed(context.request, (ws, commit) => {
			const base = createBase(ws, 'Gym');
			commit(base.changes);
			const table = createTable(
				ws,
				base.id,
				'Sets',
				[
					{ name: 'Name', type: 'text' },
					{ name: 'Reps', type: 'number' }
				],
				() => defaultViews(names.en)
			);
			commit(table.changes);
			const view = ws.views(table.id)[0];
			commit([
				{
					id: view.id,
					kind: 'view',
					base: base.id,
					parent: table.id,
					set: { config: { widths: { [table.fieldIds[1]]: 400 } } }
				}
			]);
			commit(
				insertRows(ws, table.id, [{ [table.fieldIds[0]]: 'Squat', [table.fieldIds[1]]: 5 }]).changes
			);
			return { path: tablePath(table.id) };
		});
		await open(page, path);
		await expect.poll(async () => (await header(page, 'Reps').boundingBox())?.width).toBe(400);
		await tableMenu(page, 'Fit all columns');
		await expect
			.poll(async () => (await header(page, 'Reps').boundingBox())?.width ?? 0)
			.toBeLessThan(200);
	});

	test('a column menu renames in place, retypes, inserts, hides and deletes', async ({
		page,
		context,
		account
	}) => {
		void account;
		await open(page, (await seedLifts(context.request)).path);
		const names = page.locator('thead th[scope="col"]');
		await expect(names).toHaveText(['Exercise', 'Kg', 'Style', 'Done', 'ƒ Volume']);

		await columnMenu(page, 'Exercise', 'Rename');
		const rename = page.getByRole('textbox', { name: 'Name of Exercise' });
		await expect(rename).toBeFocused();
		await rename.fill('Lift');
		await rename.press('Enter');
		await expect(names).toHaveText(['Lift', 'Kg', 'Style', 'Done', 'ƒ Volume']);

		await columnMenu(page, 'Kg', 'Insert left');
		const adding = page.getByRole('dialog', { name: 'Add a field' });
		await adding.getByRole('textbox', { name: 'Field name' }).fill('Sets');
		await adding.getByRole('textbox', { name: 'Field name' }).press('Enter');
		await expect(names).toHaveText(['Lift', 'Sets', 'Kg', 'Style', 'Done', 'ƒ Volume']);

		await columnMenu(page, 'Style', 'Hide');
		await expect(names).toHaveText(['Lift', 'Sets', 'Kg', 'Done', 'ƒ Volume']);
		await toastButton(page, 'Undo').click();
		await expect(names).toHaveText(['Lift', 'Sets', 'Kg', 'Style', 'Done', 'ƒ Volume']);

		await columnMenu(page, 'Done', 'Delete');
		await expect(names).toHaveText(['Lift', 'Sets', 'Kg', 'Style', 'ƒ Volume']);

		if (!isPhone()) {
			await header(page, 'Kg').click({ button: 'right' });
			await page.getByRole('menuitem', { name: 'Type' }).hover();
			await page.getByRole('menuitem', { name: 'Text', exact: true }).click();
			await expect(page.getByRole('status')).toContainText('Kg retyped');
			await expect(at(page, 0, 2)).toHaveText('10');
			await expect(at(page, 0, 2).locator('div').first()).not.toHaveClass(/justify-end/u);
		}
	});

	test('the blank row and the editors show each field name until filled', async ({
		page,
		context,
		account
	}) => {
		void account;
		await open(page, (await seedLifts(context.request)).path);
		await expect(at(page, 3, 0)).toHaveText('Exercise');
		await expect(at(page, 3, 1)).toHaveText('Kg');
		await expect(at(page, 3, 2)).toHaveText('Style');
		await expect(at(page, 3, 4)).toHaveText('');

		await press(at(page, 3, 0));
		if (!isPhone()) await page.keyboard.press('Enter');
		await expect(editor(page)).toHaveAttribute('placeholder', 'Exercise');
		await editor(page).press('Escape');

		await page.getByRole('button', { name: 'Add row' }).click();
		const sheet = page.getByRole('dialog', { name: 'New row' });
		await expect(sheet.getByPlaceholder('Kg', { exact: true })).toBeVisible();
	});
});

test.describe('export', () => {
	test('the table menu writes the view as CSV: its columns, its order, raw values', async ({
		page,
		context,
		account
	}, info) => {
		void account;
		await open(page, (await seedLifts(context.request)).path);
		await columnMenu(page, 'Kg', 'Sort descending');
		await columnMenu(page, 'Done', 'Hide');

		const downloading = page.waitForEvent('download');
		await tableMenu(page, 'Export as CSV');
		const file = await downloading;
		expect(file.suggestedFilename()).toBe('Lifts.csv');
		const target = info.outputPath('lifts.csv');
		await file.saveAs(target);
		const { readFileSync } = await import('node:fs');
		expect(readFileSync(target, 'utf8')).toBe(
			'\uFEFFExercise,Kg,Style,Volume\r\n' +
				'Exercise 3,30,Strict,60\r\n' +
				'Exercise 2,20,Strict,40\r\n' +
				'Exercise 1,10,Strict,20\r\n'
		);
	});
});

test.describe('rows, by hand', () => {
	test('a right-click inserts above and below, copies and deletes the selected rows', async ({
		page,
		context,
		account
	}) => {
		desktopOnly('a right-click belongs to the desktop');
		void account;
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);
		await open(page, (await seedLifts(context.request)).path);
		const first = (count: number): Promise<string[]> => column(page, 0, count);

		await at(page, 1, 1).click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Insert row above' }).click();
		await expect.poll(() => first(4)).toEqual(['Exercise 1', '', 'Exercise 2', 'Exercise 3']);
		await expect(at(page, 1, 1)).toHaveAttribute('aria-selected', 'true');

		await at(page, 3, 0).click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Insert row below' }).click();
		await expect.poll(() => first(5)).toEqual(['Exercise 1', '', 'Exercise 2', 'Exercise 3', '']);

		await at(page, 0, 0).click();
		await at(page, 0, 1).click({ modifiers: ['Shift'] });
		await at(page, 0, 1).click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Copy 2 cells' }).click();
		await expect
			.poll(() => page.evaluate(() => navigator.clipboard.readText()))
			.toBe('Exercise 1\t10');

		await at(page, 2, 0).click();
		await at(page, 3, 0).click({ modifiers: ['Shift'] });
		await at(page, 2, 0).click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Delete 2 rows' }).click();
		await expect.poll(() => first(3)).toEqual(['Exercise 1', '', '']);
		await toastButton(page, 'Undo').click();
		await expect.poll(() => first(5)).toEqual(['Exercise 1', '', 'Exercise 2', 'Exercise 3', '']);
	});

	test('the keyboard opens the row menu, the row, and the column menu', async ({
		page,
		context,
		account
	}) => {
		desktopOnly();
		void account;
		await open(page, (await seedLifts(context.request)).path);
		await at(page, 1, 1).click();

		await page.keyboard.press('Shift+F10');
		const menu = page.getByRole('menu', { name: 'Row' });
		await expect(menu).toBeVisible();
		await menu.getByRole('menuitem', { name: 'Open row' }).click();
		const row = page.getByRole('dialog', { name: 'Exercise 2' });
		await expect(row).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(row).toHaveCount(0);
		await expect(grid(page)).toBeFocused();

		await page.keyboard.press('Alt+ArrowDown');
		await page.getByRole('menuitem', { name: 'Field settings' }).click();
		await page
			.getByRole('dialog', { name: 'Field' })
			.getByRole('button', { name: 'Close' })
			.click();
		await expect(grid(page)).toBeFocused();

		await header(page, 'Kg').hover();
		await expect(page.getByRole('tooltip')).toHaveText(/Alt\+↓|⌥↓/u);
	});

	test('a long press opens the row actions on a phone', async ({ page, context, account }) => {
		test.skip(!isPhone(), 'the desktop right-clicks above');
		void account;
		await open(page, (await seedLifts(context.request)).path);
		await at(page, 1, 0).dispatchEvent('contextmenu', { bubbles: true, cancelable: true });
		const sheet = page.getByRole('dialog', { name: 'Row' });
		await sheet.getByRole('button', { name: 'Insert row above' }).click();
		await expect
			.poll(() => column(page, 0, 4))
			.toEqual(['Exercise 1', '', 'Exercise 2', 'Exercise 3']);
		await at(page, 2, 0).dispatchEvent('contextmenu', { bubbles: true, cancelable: true });
		await page
			.getByRole('dialog', { name: 'Row' })
			.getByRole('button', { name: 'Delete row' })
			.click();
		await expect.poll(() => column(page, 0, 3)).toEqual(['Exercise 1', '', 'Exercise 3']);
	});
});
