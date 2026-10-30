import type { APIRequestContext, Page } from '@playwright/test';

import { createBase, createTable, insertRows } from '../../src/lib/core/actions.ts';
import type { FieldSpec } from '../../src/lib/core/actions.ts';
import { expect, seed, test } from './harness.ts';

const LONG = 'A value far longer than any column could ever show on one line of a grid';

function seedEveryType(request: APIRequestContext) {
	return seed(request, (ws, commit) => {
		const base = createBase(ws, 'Gym');
		commit(base.changes);

		const target = createTable(ws, base.id, 'Exercises', [{ name: 'Name', type: 'text' }]);
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
		const table = createTable(ws, base.id, 'Lifts', specs);
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

		return { path: `/b/${base.id}/${table.id}` };
	});
}

const columnWidths = (page: Page): Promise<number[]> =>
	page
		.locator('thead th')
		.evaluateAll((cells) => cells.map((cell) => cell.getBoundingClientRect().width));

test('no click on a cell changes any column width', async ({ page, context, account }) => {
	void account;
	const { path } = await seedEveryType(context.request);
	await page.goto(path);

	const row = page.locator('tbody tr').first();
	await expect(row.locator('td').nth(1).getByText(LONG)).toBeVisible();
	const widths = await columnWidths(page);

	for (const [index, name] of ['text', 'number', 'date', 'choice', 'link', 'check'].entries()) {
		const cell = row.locator('td').nth(index + 1);
		await cell.getByRole('button').click();
		if (name !== 'check') {
			await expect(cell.locator('input, select')).toBeFocused();
		}
		expect(await columnWidths(page), `editing the ${name} cell`).toEqual(widths);

		await page.getByRole('heading', { name: 'Lifts' }).click();
		await expect(cell.getByRole('button')).toBeVisible();
		expect(await columnWidths(page), `leaving the ${name} cell`).toEqual(widths);
	}
});

test('a long value truncates inside its column', async ({ page, context, account }) => {
	void account;
	const { path } = await seedEveryType(context.request);
	await page.goto(path);

	const cell = page.locator('tbody tr').first().locator('td').nth(1);
	await expect(cell.getByText(LONG)).toBeVisible();
	const [cellBox, textBox] = await Promise.all([
		cell.boundingBox(),
		cell.getByRole('button').boundingBox()
	]);
	expect(textBox?.width).toBeLessThanOrEqual(cellBox?.width ?? 0);
	expect(cellBox?.width).toBe(192);
});

test('the add-field column stays reachable when the fields outgrow the screen', async ({
	page,
	context,
	account
}) => {
	void account;
	const { path } = await seedEveryType(context.request);
	await page.goto(path);

	const add = page.getByRole('button', { name: 'Ajouter un champ' });
	const column = await page.locator('thead th').filter({ has: add }).boundingBox();
	expect(column?.width).toBe(44);

	await add.click();
	await expect(page.getByRole('dialog')).toBeVisible();
});
