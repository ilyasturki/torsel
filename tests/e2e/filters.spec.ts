import names from '../../src/lib/i18n/names.ts';
import type { APIRequestContext, Locator, Page } from '@playwright/test';

import {
	createBase,
	createTable,
	createView,
	defaultViews,
	insertRows,
	updateRecord
} from '../../src/lib/core/actions.ts';
import type { Value, ViewConfig } from '../../src/lib/core/model.ts';
import { expect, openAsk as tapAsk, script, seed, tablePath, test, undo } from './harness.ts';

function seedSets(
	request: APIRequestContext,
	config: (fields: string[]) => ViewConfig = () => ({})
) {
	return seed(request, (ws, commit) => {
		const base = createBase(ws, 'Gym');
		commit(base.changes);
		const table = createTable(
			ws,
			base.id,
			'Sets',
			[
				{ name: 'Exercise', type: 'text' },
				{ name: 'Reps', type: 'number' },
				{ name: 'Kg', type: 'number' },
				{ name: 'RPE', type: 'number' }
			],
			() => defaultViews(names.en)
		);
		commit(table.changes);
		const [exercise, reps, kg, rpe] = table.fieldIds;
		const rows = insertRows(ws, table.id, [
			{ [exercise]: 'Bench', [reps]: 8, [kg]: 80, [rpe]: 8 },
			{ [exercise]: 'Squat', [reps]: 5, [kg]: 100, [rpe]: 9 },
			{ [exercise]: 'Bench', [reps]: 6, [kg]: 85, [rpe]: 9.5 },
			{ [exercise]: 'Dips', [reps]: 10, [kg]: 0, [rpe]: 7 }
		]);
		commit(rows.changes);
		const grid = ws.views(table.id).find((view) => view.type === 'grid');
		if (grid !== undefined) {
			commit(updateRecord(ws, grid.id, { config: config(table.fieldIds) as Value }));
		}
		return { base: base.id, table: table.id, rows: rows.ids, fields: table.fieldIds };
	});
}

const panel = (page: Page): Locator => page.locator('aside[aria-label="Ask"]');
const thread = (page: Page): Locator => page.getByTestId('thread');
const isPhone = (): boolean => test.info().project.name === 'phone';

async function ask(page: Page, text: string): Promise<void> {
	if (!(await panel(page).isVisible())) await tapAsk(page);
	await page.getByPlaceholder('Ask about your tables').fill(text);
	await panel(page).getByRole('button', { name: 'Send' }).click();
}

async function seeTable(page: Page): Promise<void> {
	if (isPhone() && (await panel(page).isVisible())) {
		await panel(page).getByRole('button', { name: 'Close' }).click();
	}
}

test('the assistant filters a grid and sets a colour rule, both undone from its card', async ({
	page,
	context,
	account
}) => {
	void account;
	const { table } = await seedSets(context.request);
	const key = await script(context.request, [
		{
			blocks: [
				{
					type: 'tool',
					id: 'toolu_view',
					name: 'update_view',
					input: {
						base: 'Gym',
						table: 'Sets',
						view: 'Grid',
						config: {
							filters: [
								{ field: 'Exercise', op: 'is', value: 'bench' },
								{ field: 'Kg', op: 'gte', value: 80 }
							],
							colors: [{ when: { field: 'RPE', op: 'gte', value: 9.5 }, color: 'red' }]
						}
					}
				}
			]
		},
		{ blocks: [{ type: 'text', text: 'Done.' }] }
	]);
	await page.goto(tablePath(table));
	await ask(page, `${key} only heavy bench, red when RPE hits 9.5`);

	await expect(thread(page).getByText('Done.')).toBeVisible();
	const card = thread(page).getByTestId('change');
	await expect(card).toContainText('Exercise is bench, Kg greater than or equal to 80');
	await expect(card).toContainText('RPE greater than or equal to 9.5: Red');

	await seeTable(page);
	const grid = page.getByRole('grid');
	await expect(page.getByText(/: 2 of 4$/u)).toBeVisible();
	await expect(grid.getByRole('gridcell', { name: 'Squat' })).toHaveCount(0);
	await expect(grid.getByRole('gridcell', { name: '85', exact: true })).toBeVisible();
	await expect(grid.locator('tr[data-color="red"]')).toHaveCount(1);
	await expect(grid.locator('tr[data-color="red"]')).toContainText('85');

	if (isPhone()) await tapAsk(page);
	await card.getByRole('button', { name: 'Undo' }).click();
	await seeTable(page);
	await expect(grid.getByRole('gridcell', { name: 'Squat' })).toBeVisible();
});

function seedLog(request: APIRequestContext) {
	return seed(request, (ws, commit) => {
		const base = createBase(ws, 'Gym');
		commit(base.changes);
		const table = createTable(
			ws,
			base.id,
			'Log',
			[
				{ name: 'Day', type: 'date' },
				{
					name: 'Exercise',
					type: 'choice',
					choices: [
						{ name: 'bench press', color: 'blue' },
						{ name: 'squat', color: 'green' }
					]
				},
				{ name: 'Kg', type: 'number' }
			],
			() => defaultViews(names.en)
		);
		commit(table.changes);
		const [day, exercise, kg] = table.fieldIds;
		commit(
			insertRows(ws, table.id, [
				{ [day]: '2026-10-26', [exercise]: 'bench press', [kg]: 80 },
				{ [day]: '2026-10-26', [exercise]: 'squat', [kg]: 140 },
				{ [day]: '2026-10-28', [exercise]: 'bench press', [kg]: 82.5 },
				{ [day]: '2026-10-28', [exercise]: 'squat', [kg]: 145 }
			]).changes
		);
		const bench = [{ field: exercise, op: 'any-of' as const, value: ['bench press'] }];
		const chart = createView(ws, table.id, {
			name: 'Bench',
			type: 'chart',
			config: { kind: 'line', x: day, agg: 'max', y: kg, filters: bench }
		});
		commit(chart.changes);
		const list = createView(ws, table.id, {
			name: 'Bench list',
			type: 'list',
			config: { title: exercise, show: [kg], filters: bench }
		});
		commit(list.changes);
		return { chart: tablePath(table.id, chart.id), list: tablePath(table.id, list.id) };
	});
}

test('a chart and a list show only the rows their filters keep', async ({
	page,
	context,
	account
}) => {
	void account;
	const { chart, list } = await seedLog(context.request);
	await page.goto(chart);
	const plot = page.getByRole('img', { name: 'Highest kg per Day' });
	await expect(plot).toBeVisible();
	await expect(plot).toContainText('82');
	await expect(plot).not.toContainText('140');

	await page.goto(list);
	await expect(page.getByText('82.5')).toBeVisible();
	await expect(page.getByText('145')).toHaveCount(0);
	await expect(page.getByText('squat')).toHaveCount(0);
});

test('a column totals the shown rows from its menu, and the totals row takes it back', async ({
	page,
	context,
	account
}) => {
	void account;
	const { table } = await seedSets(context.request);
	await page.goto(tablePath(table));
	const grid = page.getByRole('grid');
	await expect(grid.getByRole('gridcell', { name: 'Squat' })).toBeVisible();
	await expect(grid.locator('tfoot')).toHaveCount(0);

	await grid.getByRole('columnheader', { name: 'Kg', exact: true }).getByRole('button').click();
	if (isPhone()) {
		await page.getByRole('combobox', { name: 'Calculate' }).click();
		await page.getByRole('option', { name: 'Sum' }).click();
	} else {
		await page.getByRole('menuitem', { name: 'Calculate' }).click();
		await page.getByRole('menuitem', { name: 'Sum' }).click();
	}
	const total = grid.locator('[data-total="Kg"]');
	await expect(total).toHaveText(/265/u);
	await expect(total).toHaveAttribute('title', 'Sum of Kg');

	await grid
		.getByRole('columnheader', { name: 'Exercise', exact: true })
		.getByRole('button')
		.click();
	await page.getByRole('textbox', { name: 'Filter Exercise' }).fill('bench');
	await page.keyboard.press('Enter');
	await expect(total).toHaveText(/165/u);

	await total.click();
	await page.getByRole('menuitem', { name: 'None' }).click();
	await expect(grid.locator('tfoot')).toHaveCount(0);
});

test('the last row stays above the totals row when the keyboard reaches it', async ({
	page,
	context,
	account
}) => {
	void account;
	const { table } = await seed(context.request, (ws, commit) => {
		const base = createBase(ws, 'Gym');
		commit(base.changes);
		const made = createTable(ws, base.id, 'Long', [{ name: 'Reps', type: 'number' }], () =>
			defaultViews(names.en)
		);
		commit(made.changes);
		const [reps] = made.fieldIds;
		commit(
			insertRows(
				ws,
				made.id,
				Array.from({ length: 60 }, (_, at) => ({ [reps]: at + 1 }))
			).changes
		);
		const grid = ws.views(made.id).find((view) => view.type === 'grid');
		if (grid !== undefined) {
			commit(updateRecord(ws, grid.id, { config: { totals: { [reps]: 'sum' } } }));
		}
		return { table: made.id };
	});
	await page.goto(tablePath(table));
	const grid = page.getByRole('grid');
	await expect(grid.locator('[data-total="Reps"]')).toContainText('1830');

	await grid.locator('td[data-r="0"][data-c="0"]').click();
	await page.keyboard.press('ControlOrMeta+End');
	const last = grid.locator('td[data-r="59"][data-c="0"]');
	await expect(last).toHaveText('60');
	const cell = await last.boundingBox();
	const foot = await grid.locator('tfoot').boundingBox();
	expect(cell !== null && foot !== null && cell.y + cell.height <= foot.y + 1).toBe(true);
});

/** The filter or colour editor: a popover from the header's icon, a drawer from the table "…" on a phone. */
async function openRules(page: Page, name: string, more = 'More'): Promise<Locator> {
	if (isPhone()) {
		await page.getByRole('button', { name: more, exact: true }).click();
		await page.getByRole('dialog').getByRole('button', { name }).click();
		return page.getByRole('dialog', { name });
	}
	await page.getByRole('button', { name: new RegExp(`^${name}`, 'u') }).click();
	return page.getByRole('dialog', { name });
}

async function pick(scope: Locator, label: string, option: string): Promise<void> {
	await scope.getByRole('combobox', { name: label }).click();
	await scope.page().getByRole('option', { name: option, exact: true }).click();
}

test('the header filters the grid by several typed conditions and colours its rows', async ({
	page,
	context,
	account
}) => {
	void account;
	const { table } = await seedSets(context.request);
	await page.goto(tablePath(table));
	const grid = page.getByRole('grid');
	await expect(grid.getByRole('gridcell', { name: 'Squat' })).toBeVisible();

	let editor = await openRules(page, 'Filter');
	await editor.getByRole('button', { name: 'Add condition' }).click();
	const first = editor.locator('[data-condition]').first();
	await first.getByRole('textbox', { name: 'Value' }).fill('bench');
	await first.getByRole('textbox', { name: 'Value' }).press('Enter');
	await expect(page.getByText(/: 2 of 4$/u)).toBeVisible();

	await editor.getByRole('button', { name: 'Add condition' }).click();
	const second = editor.locator('[data-condition]').nth(1);
	await pick(second, 'Field', 'Kg');
	await pick(second, 'Condition', 'greater than');
	await second.getByRole('textbox', { name: 'Value' }).fill('80');
	await second.getByRole('textbox', { name: 'Value' }).press('Enter');
	await expect(page.getByText(/: 1 of 4$/u)).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('dialog', { name: 'Filter' })).toHaveCount(0);
	if (!isPhone()) await expect(page.getByRole('button', { name: 'Filter (2)' })).toBeVisible();

	editor = await openRules(page, 'Colours');
	await editor.getByRole('button', { name: 'Add rule' }).click();
	const rule = editor.locator('[data-condition]').first();
	await pick(rule, 'Field', 'RPE');
	await pick(rule, 'Condition', 'greater than or equal to');
	await rule.getByRole('textbox', { name: 'Value' }).fill('9.5');
	await rule.getByRole('textbox', { name: 'Value' }).press('Enter');
	await page.keyboard.press('Escape');
	await expect(grid.locator('tr[data-color="red"]')).toHaveCount(1);
	await expect(grid.locator('tr[data-color="red"]')).toContainText('85');

	await undo(page);
	await expect(grid.locator('tr[data-color="red"]')).toHaveCount(0);
});

test.describe('in French', () => {
	test.use({ locale: 'fr-FR' });

	test('the filter line and the totals read in French, numbers in its own forms', async ({
		page,
		context,
		account
	}) => {
		void account;
		const { table } = await seedSets(context.request, ([exercise, , kg]) => ({
			filters: [
				{ field: exercise, op: 'contains', value: 'ench' },
				{ field: kg, op: 'gte', value: 80 }
			],
			totals: { [kg]: 'avg' }
		}));
		await page.goto(tablePath(table));
		await expect(
			page.getByText(
				'Exercise contient «\u00a0ench\u00a0», Kg supérieur ou égal à 80\u00a0: 2 sur 4'
			)
		).toBeVisible();
		const total = page.getByRole('grid').locator('[data-total="Kg"]');
		await expect(total).toHaveText(/82,5/u);
		await expect(total).toHaveAttribute('title', 'Moyenne de Kg');

		const editor = await openRules(page, 'Couleurs', 'Plus');
		await editor.getByRole('button', { name: 'Ajouter une règle' }).click();
		const rule = editor.locator('[data-condition]').first();
		await pick(rule, 'Champ', 'RPE');
		await pick(rule, 'Condition', 'supérieur ou égal à');
		await rule.getByRole('textbox', { name: 'Valeur' }).fill('9,5');
		await rule.getByRole('textbox', { name: 'Valeur' }).press('Enter');
		await page.keyboard.press('Escape');
		await expect(page.getByRole('grid').locator('tr[data-color="red"]')).toHaveCount(1);
	});
});
