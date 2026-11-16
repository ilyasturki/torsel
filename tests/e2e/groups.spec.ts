import names from '../../src/lib/i18n/names.ts';
import type { APIRequestContext, Page } from '@playwright/test';

import {
	createBase,
	createTable,
	defaultViews,
	insertRows,
	updateRecord
} from '../../src/lib/core/actions.ts';
import type { Value, ViewConfig } from '../../src/lib/core/model.ts';
import { expect, seed, tablePath, test, viewSettings } from './harness.ts';

const isPhone = (): boolean => test.info().project.name === 'phone';

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
				{ name: 'Kg', type: 'number' },
				{ name: 'RPE', type: 'number' }
			],
			() => defaultViews(names.en)
		);
		commit(table.changes);
		const [exercise, kg, rpe] = table.fieldIds;
		commit(
			insertRows(ws, table.id, [
				{ [exercise]: 'Bench', [kg]: 80, [rpe]: 8 },
				{ [exercise]: 'Squat', [kg]: 100, [rpe]: 9 },
				{ [exercise]: 'Bench', [kg]: 85, [rpe]: 9.5 },
				{ [exercise]: 'Dips', [kg]: 0, [rpe]: 7 },
				{ [kg]: 20 }
			]).changes
		);
		const grid = ws.views(table.id).find((view) => view.type === 'grid');
		if (grid !== undefined) {
			commit(updateRecord(ws, grid.id, { config: config(table.fieldIds) as Value }));
		}
		return { table: table.id };
	});
}

async function columnMenu(page: Page, field: string, item: string): Promise<void> {
	await page
		.getByRole('grid')
		.getByRole('columnheader', { name: field, exact: true })
		.getByRole('button')
		.click();
	if (isPhone()) await page.getByRole('dialog').getByRole('button', { name: item }).click();
	else await page.getByRole('menuitem', { name: item }).click();
}

test('a column groups the rows, each header carrying its count and subtotals, folded on this device', async ({
	page,
	context,
	account
}) => {
	void account;
	const { table } = await seedSets(context.request, ([, kg]) => ({ totals: { [kg]: 'sum' } }));
	await page.goto(tablePath(table));
	const grid = page.getByRole('grid');
	await expect(grid.locator('[data-total="Kg"]')).toContainText('285');

	await columnMenu(page, 'Exercise', 'Group rows');
	const headers = grid.locator('tr[data-group]');
	await expect(headers).toHaveCount(4);
	await expect(headers.getByRole('button')).toHaveText([
		/Bench\s*2/u,
		/Dips\s*1/u,
		/Squat\s*1/u,
		/No value\s*1/u
	]);
	const bench = headers.first();
	await expect(bench).toContainText('165');
	await expect(bench.locator('[title="Sum of Kg"]')).toHaveText('165');

	await bench.getByRole('button').click();
	await expect(bench.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
	await expect(grid.getByRole('gridcell', { name: 'Bench', exact: true })).toHaveCount(0);
	await expect(bench).toContainText('165');
	await expect(grid.locator('[data-total="Kg"]')).toContainText('285');

	await page.reload();
	await expect(grid.locator('tr[data-group]').first().getByRole('button')).toHaveAttribute(
		'aria-expanded',
		'false'
	);
	await expect(grid.getByRole('gridcell', { name: 'Squat', exact: true })).toBeVisible();
	await expect(grid.getByRole('gridcell', { name: 'Bench', exact: true })).toHaveCount(0);

	await columnMenu(page, 'Exercise', 'Ungroup');
	await expect(headers).toHaveCount(0);
	await expect(grid.getByRole('gridcell', { name: 'Bench', exact: true })).toHaveCount(2);
});

test('a range cleared across a folded group leaves its rows alone', async ({
	page,
	context,
	account
}) => {
	void account;
	const { table } = await seedSets(context.request, ([exercise]) => ({ group: exercise }));
	await page.goto(tablePath(table));
	const grid = page.getByRole('grid');
	const dips = grid.locator('tr[data-group]').filter({ hasText: 'Dips' });
	await dips.getByRole('button').click();
	await expect(grid.getByRole('gridcell', { name: 'Dips', exact: true })).toHaveCount(0);

	await grid.getByRole('gridcell', { name: '9.5', exact: true }).click();
	if (isPhone()) await page.keyboard.press('Escape');
	await page.keyboard.press('Shift+ArrowDown');
	await page.keyboard.press('Delete');
	await expect(grid.getByRole('gridcell', { name: '9.5', exact: true })).toHaveCount(0);
	await expect(grid.getByRole('gridcell', { name: '9', exact: true })).toHaveCount(0);

	await dips.getByRole('button').click();
	await expect(grid.getByRole('gridcell', { name: '7', exact: true })).toBeVisible();
});

test('a long grouped grid of tall rows edits and selects the row under the pointer, far down', async ({
	page,
	context,
	account
}) => {
	void account;
	const { table } = await seed(context.request, (ws, commit) => {
		const base = createBase(ws, 'Log');
		commit(base.changes);
		const made = createTable(
			ws,
			base.id,
			'Long',
			[
				{ name: 'Week', type: 'text' },
				{ name: 'N', type: 'number' }
			],
			() => defaultViews(names.en)
		);
		commit(made.changes);
		const [week, n] = made.fieldIds;
		commit(
			insertRows(
				ws,
				made.id,
				Array.from({ length: 150 }, (_, at) => ({
					[week]: `W${Math.floor(at / 10)}`,
					[n]: at
				}))
			).changes
		);
		const grid = ws.views(made.id).find((view) => view.type === 'grid');
		if (grid !== undefined) {
			commit(
				updateRecord(ws, grid.id, {
					config: { group: week, totals: { [n]: 'sum' }, tall: true } as Value
				})
			);
		}
		return { table: made.id };
	});
	await page.goto(tablePath(table));
	const grid = page.getByRole('grid');
	await expect(grid.locator('tr[data-group]').first()).toContainText('W0');

	await grid
		.locator('xpath=ancestor::div[contains(@class, "overflow-auto")][1]')
		.evaluate((node) => {
			node.scrollTop = node.scrollHeight;
		});
	const w14 = grid.locator('tr[data-group]').filter({ hasText: 'W14' });
	await expect(w14).toContainText(/1,?445/u);

	const cell = grid.getByRole('gridcell', { name: '147', exact: true });
	await cell.click();
	if (isPhone()) await page.keyboard.press('Escape');
	await page.keyboard.type('1000');
	await page.keyboard.press('Enter');
	await expect(grid.getByRole('gridcell', { name: /^1,?000$/u })).toBeVisible();
	await expect(grid.getByRole('gridcell', { name: '147', exact: true })).toHaveCount(0);
	await expect(w14).toContainText(/2,?298/u);

	if (isPhone()) return;
	await grid.getByRole('gridcell', { name: '138', exact: true }).scrollIntoViewIfNeeded();
	const from = await grid.getByRole('gridcell', { name: '138', exact: true }).boundingBox();
	const to = await grid.getByRole('gridcell', { name: '141', exact: true }).boundingBox();
	if (from === null || to === null) throw new Error('cells off screen');
	await page.mouse.move(from.x + 10, from.y + from.height / 2);
	await page.mouse.down();
	await page.mouse.move(to.x + 10, to.y + to.height / 2, { steps: 8 });
	await page.mouse.up();
	await expect(page.getByText(/^Count\s*4$/u).first()).toBeVisible();
	await expect(page.getByText(/^Sum\s*558$/u).first()).toBeVisible();

	await page.keyboard.press('ControlOrMeta+Home');
	const first = await grid.locator('tr[data-group]').first().boundingBox();
	const head = await grid.locator('thead').boundingBox();
	expect(first !== null && head !== null && first.y >= head.y + head.height - 1).toBe(true);
});

test('a row inserted inside a group stays in it', async ({ page, context, account }) => {
	void account;
	const { table } = await seed(context.request, (ws, commit) => {
		const base = createBase(ws, 'Body');
		commit(base.changes);
		const made = createTable(
			ws,
			base.id,
			'Weigh-ins',
			[
				{ name: 'Day', type: 'date' },
				{ name: 'Kg', type: 'number' }
			],
			() => defaultViews(names.en)
		);
		commit(made.changes);
		const [day, kg] = made.fieldIds;
		commit(
			insertRows(ws, made.id, [
				{ [day]: '2025-03-01', [kg]: 80 },
				{ [day]: '2025-03-01', [kg]: 81 },
				{ [day]: '2025-03-02', [kg]: 79 },
				{ [kg]: 70 }
			]).changes
		);
		const grid = ws.views(made.id).find((view) => view.type === 'grid');
		if (grid !== undefined) commit(updateRecord(ws, grid.id, { config: { group: day } }));
		return { table: made.id };
	});
	await page.goto(tablePath(table));
	const grid = page.getByRole('grid');
	const headers = grid.locator('tr[data-group]');
	await expect(headers).toHaveCount(3);

	const eighty = grid.getByRole('gridcell', { name: '80', exact: true });
	if (isPhone()) {
		await eighty.dispatchEvent('contextmenu', { bubbles: true, cancelable: true });
		await page
			.getByRole('dialog', { name: 'Row' })
			.getByRole('button', { name: 'Insert row below' })
			.click();
	} else {
		await eighty.click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Insert row below' }).click();
	}
	await expect(headers).toHaveCount(3);
	await expect(headers.first().getByRole('button')).toHaveText(/Mar 1, 2025\s*3/u);
});

test('a row added to a folded group opens it', async ({ page, context, account }) => {
	void account;
	const { table } = await seedSets(context.request, ([exercise]) => ({ group: exercise }));
	await page.goto(tablePath(table));
	const grid = page.getByRole('grid');
	const headers = grid.locator('tr[data-group]');
	const blank = headers.filter({ hasText: 'No value' });
	await blank.getByRole('button').click();
	await expect(grid.getByRole('gridcell', { name: '20', exact: true })).toHaveCount(0);
	await grid.getByRole('button', { name: 'New row' }).click();
	if (isPhone()) await page.keyboard.press('Escape');
	await page.keyboard.press('ArrowRight');
	await page.keyboard.type('72');
	await page.keyboard.press('Enter');
	await expect(blank.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
	await expect(blank.getByRole('button')).toHaveText(/No value\s*2/u);
	await expect(grid.getByRole('gridcell', { name: '72', exact: true })).toBeVisible();
});

test('the view settings group the grid and take it back', async ({ page, context, account }) => {
	void account;
	const { table } = await seedSets(context.request);
	await page.goto(tablePath(table));
	await viewSettings(page);
	const settings = page.getByRole('dialog', { name: 'View settings' });
	await settings.getByRole('combobox', { name: 'Group by' }).click();
	await page.getByRole('option', { name: 'Exercise', exact: true }).click();
	const headers = page.getByRole('grid').locator('tr[data-group]');
	await expect(headers).toHaveCount(4);
	await settings.getByRole('combobox', { name: 'Group by' }).click();
	await page.getByRole('option', { name: 'Nothing', exact: true }).click();
	await expect(headers).toHaveCount(0);
});

test.describe('in French', () => {
	test.use({ locale: 'fr-FR' });

	test('the column menu groups, and rows with no value gather under their own header', async ({
		page,
		context,
		account
	}) => {
		void account;
		const { table } = await seedSets(context.request);
		await page.goto(tablePath(table));
		await columnMenu(page, 'Exercise', 'Grouper les lignes');
		await expect(page.getByRole('grid').locator('tr[data-group]').last()).toContainText(
			/Sans valeur\s*1/u
		);
	});
});
