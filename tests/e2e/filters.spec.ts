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
import { expect, openAsk as tapAsk, script, seed, tablePath, test } from './harness.ts';

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
	await expect(total).toHaveText(/Sum\s*265/u);

	await grid
		.getByRole('columnheader', { name: 'Exercise', exact: true })
		.getByRole('button')
		.click();
	await page.getByRole('textbox', { name: 'Filter Exercise' }).fill('bench');
	await page.keyboard.press('Enter');
	await expect(total).toHaveText(/Sum\s*165/u);

	await total.click();
	await page.getByRole('menuitem', { name: 'None' }).click();
	await expect(grid.locator('tfoot')).toHaveCount(0);
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
		await expect(page.getByRole('grid').locator('[data-total="Kg"]')).toHaveText(/Moyenne\s*82,5/u);
	});
});
