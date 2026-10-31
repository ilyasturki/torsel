import type { APIRequestContext, Locator, Page } from '@playwright/test';

import { createBase, createTable, createView, insertRows } from '../../src/lib/core/actions.ts';
import { expect, newAccount, RETRY_RESET, seed, signIn, test } from './harness.ts';

const cell = (page: Page, name: string): Locator =>
	page.getByRole('gridcell', { name, exact: true });

const header = (page: Page, name: string): Locator =>
	page.getByRole('columnheader', { name, exact: true });

const headerButton = (page: Page, name: string): Locator =>
	page.getByRole('banner').getByRole('button', { name, exact: true });

const onPhone = (): boolean => test.info().project.name === 'phone';

async function editCell(page: Page, from: string, to: string): Promise<void> {
	await cell(page, from).dblclick();
	const editor = page.getByRole('gridcell').getByRole('textbox');
	await editor.fill(to);
	await editor.press('Enter');
	await expect(cell(page, to)).toBeVisible();
}

async function openField(page: Page, name: string): Promise<Locator> {
	await header(page, name).getByRole('button').click();
	await page.getByRole('button', { name: 'Field settings' }).click();
	return page.getByRole('dialog', { name: 'Field', exact: true });
}

function seedGym(request: APIRequestContext) {
	return seed(request, (ws, commit) => {
		const base = createBase(ws, 'Tables');
		commit(base.changes);
		const table = createTable(ws, base.id, 'Lifts', [
			{ name: 'Date', type: 'date' },
			{
				name: 'Exercise',
				type: 'choice',
				choices: [
					{ name: 'Squat', color: null },
					{ name: 'Bench', color: null }
				]
			},
			{ name: 'Kg', type: 'number', step: 2.5 },
			{ name: 'Reps', type: 'number' }
		]);
		commit(table.changes);
		const [date, exercise, kg, reps] = table.fieldIds;
		commit(
			insertRows(ws, table.id, [
				{ [date]: '2026-10-20', [exercise]: 'Bench', [kg]: 80, [reps]: 8 },
				{ [date]: '2026-10-22', [exercise]: 'Squat', [kg]: 100, [reps]: 5 }
			]).changes
		);
		const chart = createView(ws, table.id, { name: 'Volume', type: 'chart', config: {} });
		commit(chart.changes);
		const list = createView(ws, table.id, { name: 'Sets', type: 'list', config: {} });
		commit(list.changes);
		return {
			table: table.id,
			grid: table.viewIds[0],
			entry: table.viewIds[1],
			chart: chart.id,
			list: list.id,
			path: `/app/t/${table.id}`
		};
	});
}

async function dropFile(page: Page, name: string, text: string): Promise<void> {
	const transfer = await page.evaluateHandle(
		({ name, text }) => {
			const data = new DataTransfer();
			data.items.add(new File([text], name, { type: 'text/csv' }));
			return data;
		},
		{ name, text }
	);
	await page.dispatchEvent('main', 'dragover', { dataTransfer: transfer });
	await page.dispatchEvent('main', 'drop', { dataTransfer: transfer });
}

async function pasteText(page: Page, text: string): Promise<void> {
	await page.evaluate((value) => {
		const data = new DataTransfer();
		data.setData('text/plain', value);
		const target = document.activeElement ?? document.body;
		target.dispatchEvent(
			new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
		);
	}, text);
}

/** Pointer activations on the page from now on, the audit's count of taps and clicks. */
async function countTaps(page: Page): Promise<() => Promise<number>> {
	await page.evaluate(() => {
		const scope = window as unknown as { taps: number };
		scope.taps = 0;
		window.addEventListener(
			'click',
			(event) => {
				if (event.detail > 0) scope.taps += 1;
			},
			true
		);
	});
	return () => page.evaluate(() => (window as unknown as { taps: number }).taps);
}

test.describe('the first table', () => {
	test('naming it leads straight to its fields, and the first values type them', async ({
		page,
		account
	}) => {
		void account;
		await page.goto('/app');
		const name = page.getByRole('textbox', { name: 'Table name' });
		await name.fill('Weigh-ins');
		await name.press('Enter');

		await expect(page.getByRole('heading', { name: 'Weigh-ins' })).toBeVisible();
		const field = page.getByRole('textbox', { name: 'Field name' });
		await expect(field).toBeFocused();
		await field.fill('Day');
		await field.press('Enter');
		await expect(field).toBeFocused();
		await field.fill('Kg');
		await field.press('Enter');
		await field.press('Escape');

		await expect(header(page, 'Day')).toBeVisible();
		await expect(header(page, 'Kg')).toBeVisible();
		await expect(page.getByText('This table is empty.')).toBeVisible();

		await page.getByRole('button', { name: 'Add row' }).click();
		const sheet = page.getByRole('dialog');
		await sheet.getByLabel('Day').fill('30/10/2026');
		await sheet.getByLabel('Kg').fill('81,5');
		await sheet.getByLabel('Kg').press('Enter');

		await expect(cell(page, '81.5')).toBeVisible();
		await expect(cell(page, 'Oct 30, 2026').or(cell(page, 'Oct 30'))).toBeVisible();
		await expect(page.getByText('This table is empty.')).toHaveCount(0);
	});

	test('the plus gives a sheet whose title you type over', async ({ page, account }) => {
		void account;
		await page.goto('/app');
		await page.getByRole('button', { name: 'New table' }).last().click();

		const title = page.getByRole('textbox', { name: 'Table name' });
		await expect(title).toBeFocused();
		await expect(title).toHaveValue('Table 1');
		await page.keyboard.type('Expenses');
		await page.keyboard.press('Enter');

		await expect(page.getByRole('heading', { name: 'Expenses', exact: true })).toBeVisible();
		const tabs = page.getByRole('group', { name: 'Tables' });
		await expect(tabs.getByRole('link', { name: 'Expenses', exact: true })).toBeVisible();
		await expect(page.getByRole('textbox', { name: 'Field name' })).toBeFocused();
		await page.keyboard.press('Escape');

		await headerButton(page, 'Undo').click();
		await expect(page.getByRole('heading', { name: 'Table 1' })).toBeVisible();
	});

	test('a type chosen on the spot sticks, and one that needs more opens the field sheet', async ({
		page,
		account
	}) => {
		void account;
		await page.goto('/app');
		await page.getByRole('textbox', { name: 'Table name' }).fill('Books');
		await page.keyboard.press('Enter');

		const field = page.getByRole('textbox', { name: 'Field name' });
		await field.fill('Code');
		await page.getByRole('combobox', { name: 'Field type' }).selectOption('text');
		await page.getByRole('button', { name: 'Add', exact: true }).click();
		await expect(header(page, 'Code')).toBeVisible();

		await field.fill('Genre');
		await page.getByRole('combobox', { name: 'Field type' }).selectOption('choice');
		await field.press('Enter');
		const sheet = page.getByRole('dialog', { name: 'New field' });
		await expect(sheet.getByLabel('Name')).toHaveValue('Genre');
		await sheet.getByRole('textbox', { name: 'Add a choice' }).fill('Novel');
		await sheet.getByRole('textbox', { name: 'Add a choice' }).press('Enter');
		await sheet.getByRole('textbox', { name: 'Add a choice' }).press('Enter');
		await expect(header(page, 'Genre')).toBeVisible();

		await page.getByRole('button', { name: 'Add row' }).click();
		const row = page.getByRole('dialog', { name: 'New row' });
		await row.getByLabel('Code').fill('0612');
		await row.getByLabel('Genre').selectOption('Novel');
		await row.getByRole('button', { name: 'Save' }).click();
		await expect(cell(page, '0612')).toBeVisible();
		await expect(cell(page, 'Novel')).toBeVisible();
	});

	test('adding fields past the screen edge leaves the shell in place', async ({
		page,
		context,
		account
	}) => {
		void account;
		const { path } = await seedGym(context.request);
		await page.goto(path);
		await expect(cell(page, '100')).toBeVisible();

		await page.getByRole('button', { name: 'Add a field' }).click();
		const field = page.getByRole('textbox', { name: 'Field name' });
		for (const name of ['RPE', 'Tempo', 'Rest', 'Mood', 'Sleep', 'Note']) {
			await field.fill(name);
			await field.press('Enter');
			await expect(header(page, name)).toBeVisible();
		}

		const box = await page.getByRole('dialog', { name: 'Add a field' }).boundingBox();
		const width = page.viewportSize()?.width ?? 0;
		expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
		expect(await page.evaluate(() => document.scrollingElement?.scrollWidth)).toBe(width);
		await expect(page.getByRole('button', { name: 'Add a field' })).toBeInViewport();
	});

	test('dropping a CSV on the empty home imports it in one more key', async ({ page, account }) => {
		void account;
		await page.goto('/app');
		await expect(page.getByText('No tables yet.')).toBeVisible();

		await dropFile(page, 'weigh-ins.csv', 'date,kg\n2026-10-30,81.5\n2026-10-31,81.2\n');
		const sheet = page.getByRole('dialog', { name: 'Import' });
		await expect(sheet.getByText('2 columns, 2 rows')).toBeVisible();
		await page.keyboard.press('Enter');

		await expect(page.getByRole('heading', { name: 'weigh-ins' })).toBeVisible();
		await expect(cell(page, '81.2')).toBeVisible();
		await expect(page.getByRole('status')).toContainText('2 rows imported');
	});

	test('pasting cells on the empty home starts a table, a header or not', async ({
		page,
		account
	}) => {
		void account;
		await page.goto('/app');
		await expect(page.getByText('No tables yet.')).toBeVisible();

		await pasteText(page, 'Squat\t100\nBench\t80');
		const sheet = page.getByRole('dialog', { name: 'Import' });
		await expect(sheet.getByText('2 columns, 2 rows')).toBeVisible();
		await sheet.getByRole('button', { name: 'Import' }).click();

		await expect(cell(page, 'Squat')).toBeVisible();
		await expect(header(page, 'Column 2')).toBeVisible();
		await expect(cell(page, '100')).toBeVisible();
	});

	test('pasting into the name field starts a table too', async ({ page, account }) => {
		void account;
		await page.goto('/app');
		await page.getByRole('textbox', { name: 'Table name' }).focus();
		await pasteText(page, 'name\tkg\nSquat\t100');

		const sheet = page.getByRole('dialog', { name: 'Import' });
		await expect(sheet.getByText('2 columns, 1 row', { exact: true })).toBeVisible();
	});

	test('a blank table takes pasted cells and drops its unused column', async ({
		page,
		account
	}) => {
		void account;
		await page.goto('/app');
		await page.getByRole('button', { name: 'New table' }).last().click();
		await expect(page.getByRole('textbox', { name: 'Table name' })).toBeFocused();
		await expect(page.getByText('This table is empty.')).toBeVisible();

		await pasteText(page, 'exercise\tkg\nSquat\t100');
		const sheet = page.getByRole('dialog', { name: 'Import' });
		await expect(sheet.getByRole('combobox', { name: 'Into' })).toHaveValue(/^t_/u);
		await sheet.getByRole('button', { name: 'Import' }).click();

		await expect(header(page, 'exercise')).toBeVisible();
		await expect(cell(page, 'Squat')).toBeVisible();
		await expect(header(page, 'Name')).toHaveCount(0);
	});

	test('a blank table keeps the fields someone added when a file fills it', async ({
		page,
		account
	}) => {
		void account;
		await page.goto('/app');
		await page.getByRole('textbox', { name: 'Table name' }).fill('Lifts');
		await page.keyboard.press('Enter');
		const field = page.getByRole('textbox', { name: 'Field name' });
		await field.fill('Day');
		await field.press('Enter');
		await field.press('Escape');
		await expect(header(page, 'Day')).toBeVisible();

		await dropFile(page, 'lifts.csv', 'exercise,kg\nSquat,100\n');
		const sheet = page.getByRole('dialog', { name: 'Import' });
		await expect(sheet.getByRole('combobox', { name: 'Field for kg' })).toBeVisible();
		await expect(sheet.getByText('exercise', { exact: true })).toBeVisible();
		await expect(sheet.getByText('Squat', { exact: true })).toBeVisible();
		await page.keyboard.press('Enter');

		await expect(cell(page, 'Squat')).toBeVisible();
		await expect(header(page, 'Day')).toBeVisible();
		await expect(header(page, 'Name')).toHaveCount(0);
	});
});

test.describe('opening where you left off', () => {
	test('a cold open returns to the last table and view, and All stays on All', async ({
		page,
		context,
		account
	}) => {
		void account;
		const { table, chart } = await seedGym(context.request);
		await page.goto('/app');
		await expect(page.getByRole('heading', { name: 'Tables' })).toBeVisible();

		await page.goto(`/app/t/${table}?v=${chart}`);
		await expect(page.getByRole('img', { name: /per Date/u })).toBeVisible();

		await page.goto('/app');
		await expect(page).toHaveURL(new RegExp(`/app/t/${table}`, 'u'));
		await expect(page.getByRole('img', { name: /per Date/u })).toBeVisible();

		const tabs = page.getByRole('group', { name: 'Tables' });
		await tabs.getByRole('link', { name: 'All' }).click();
		await expect(page).toHaveURL(/\/app$/u);
		await expect(page.getByRole('heading', { name: 'Tables' })).toBeVisible();

		await page.goto('/app');
		await expect(page).toHaveURL(/\/app$/u);
		await tabs.getByRole('link', { name: 'Lifts' }).click();
		await expect(page.getByRole('img', { name: /per Date/u })).toBeVisible();
	});

	test('a table reopens on the view it was left on, per table', async ({
		page,
		context,
		account
	}) => {
		void account;
		const { path, list } = await seedGym(context.request);
		await page.goto(`${path}?v=${list}`);
		await expect(
			page.getByRole('group', { name: 'Views' }).getByRole('link', { name: 'Sets' })
		).toHaveAttribute('aria-current', 'page');

		await page.goto(path);
		await expect(
			page.getByRole('group', { name: 'Views' }).getByRole('link', { name: 'Sets' })
		).toHaveAttribute('aria-current', 'page');
	});

	test('on a phone, a cold open logs a set in three taps at most', async ({
		page,
		context,
		account
	}) => {
		test.skip(!onPhone(), 'the audit counts this job on a phone');
		void account;
		const { table, entry, grid } = await seedGym(context.request);
		await page.goto(`/app/t/${table}?v=${entry}`);
		await page.getByRole('button', { name: 'Add row' }).click();
		await expect(page.getByText('3 rows')).toBeVisible();

		await page.goto(`/app/t/${table}?v=${grid}`);
		await expect(cell(page, 'Squat').first()).toBeVisible();

		await page.goto('/app');
		await expect(page.getByRole('button', { name: 'Add row' })).toBeVisible();
		await expect(page).toHaveURL(new RegExp(`/app/t/${table}`, 'u'));
		const taps = await countTaps(page);

		await page.getByRole('button', { name: 'Bench', exact: true }).click();
		await page.getByRole('button', { name: 'Kg plus' }).click();
		await page.getByRole('button', { name: 'Add row' }).click();

		await expect(page.getByText('4 rows')).toBeVisible();
		expect(await taps()).toBeLessThanOrEqual(3);
		await expect(page.getByRole('textbox', { name: 'Kg' })).toHaveValue('82.5');
	});
});

test.describe('adding and correcting rows', () => {
	test('every view adds a row in one tap, with the date on today', async ({
		page,
		context,
		account
	}) => {
		void account;
		const { path, grid, list, chart } = await seedGym(context.request);
		const sheet = page.getByRole('dialog', { name: 'New row' });
		const today = new Date().toISOString().slice(0, 10);

		for (const [view, button] of [
			[grid, 'Add row'],
			[list, 'New row'],
			[chart, 'New row']
		]) {
			await page.goto(`${path}?v=${view}`);
			const taps = await countTaps(page);
			await page.getByRole('button', { name: button }).click();
			await expect(sheet.getByLabel('Date')).toHaveValue(today);
			expect(await taps()).toBe(1);
			await page.keyboard.press('Escape');
			await expect(sheet).toHaveCount(0);
		}
	});

	test('an empty list and an empty chart offer a row', async ({ page, context, account }) => {
		void account;
		const { table, list, chart } = await seed(context.request, (ws, commit) => {
			const base = createBase(ws, 'Tables');
			commit(base.changes);
			const made = createTable(ws, base.id, 'Weight', [{ name: 'Kg', type: 'number' }]);
			commit(made.changes);
			const listView = createView(ws, made.id, { name: 'Sets', type: 'list', config: {} });
			commit(listView.changes);
			const chartView = createView(ws, made.id, { name: 'Trend', type: 'chart', config: {} });
			commit(chartView.changes);
			return { table: made.id, list: listView.id, chart: chartView.id };
		});

		for (const view of [list, chart]) {
			await page.goto(`/app/t/${table}?v=${view}`);
			await page.getByRole('button', { name: 'Add a row' }).click();
			await expect(page.getByRole('dialog', { name: 'New row' })).toBeVisible();
			await page.keyboard.press('Escape');
		}
	});

	test('a recent row in Entry opens for correction', async ({ page, context, account }) => {
		void account;
		const { path, entry } = await seedGym(context.request);
		await page.goto(`${path}?v=${entry}`);

		const latest = page.getByRole('listitem').getByRole('button').last();
		await latest.click();
		const sheet = page.getByRole('dialog', { name: 'Row', exact: true });
		await expect(sheet.getByLabel('Kg')).toHaveValue('100');
		await sheet.getByLabel('Kg').fill('105');
		await sheet.getByRole('button', { name: 'Save' }).click();

		await expect(latest).toContainText('105');
	});

	test('"Last time" stays on an earlier day after a set is logged today', async ({
		page,
		context,
		account
	}) => {
		void account;
		const { path, entry } = await seedGym(context.request);
		await page.goto(`${path}?v=${entry}`);
		const lastTime = page.getByText(/^Last time/u);
		await expect(lastTime).toContainText('Oct 22');

		await page.getByRole('button', { name: 'Kg plus' }).click();
		await page.getByRole('button', { name: 'Add row' }).click();
		await expect(page.getByText('3 rows')).toBeVisible();

		await expect(lastTime).toContainText('Oct 22');
		await expect(page.getByText('100 · 5').first()).toBeVisible();
	});
});

test.describe('fields and views', () => {
	test('a field changes type: values convert, the sheet warns, undo restores', async ({
		page,
		context,
		account
	}) => {
		void account;
		const { path } = await seed(context.request, (ws, commit) => {
			const base = createBase(ws, 'Tables');
			commit(base.changes);
			const table = createTable(ws, base.id, 'Notes', [{ name: 'Value', type: 'text' }]);
			commit(table.changes);
			commit(
				insertRows(ws, table.id, [{ [table.fieldIds[0]]: '12' }, { [table.fieldIds[0]]: 'plenty' }])
					.changes
			);
			return { path: `/app/t/${table.id}` };
		});
		await page.goto(path);
		await openField(page, 'Value');

		const sheet = page.getByRole('dialog');
		await sheet.getByRole('combobox', { name: 'Type' }).selectOption('number');
		await expect(sheet.getByText("1 value can't become Number and will be cleared.")).toBeVisible();
		await sheet.getByRole('button', { name: 'Save' }).click();

		await expect(cell(page, '12')).toBeVisible();
		await expect(cell(page, 'plenty')).toHaveCount(0);

		await headerButton(page, 'Undo').click();
		await expect(cell(page, 'plenty')).toBeVisible();
	});

	test('fields and views move, and each move undoes', async ({ page, context, account }) => {
		void account;
		const { path, list } = await seedGym(context.request);
		await page.goto(path);

		const names = (): Promise<string[]> =>
			page
				.locator('thead th button')
				.evaluateAll((items) =>
					items.map((item) => item.textContent?.trim() ?? '').filter((name) => name !== '')
				);
		await expect.poll(names).toEqual(['Date', 'Exercise', 'Kg', 'Reps']);

		await openField(page, 'Kg');
		const sheet = page.getByRole('dialog');
		await sheet.getByRole('button', { name: 'Move left' }).click();
		await sheet.getByRole('button', { name: 'Close' }).click();
		await expect.poll(names).toEqual(['Date', 'Kg', 'Exercise', 'Reps']);
		await headerButton(page, 'Undo').click();
		await expect.poll(names).toEqual(['Date', 'Exercise', 'Kg', 'Reps']);

		await page.goto(`${path}?v=${list}`);
		const views = page.getByRole('group', { name: 'Views' }).getByRole('link');
		await expect(views).toHaveText(['Grid', 'Entry', 'Volume', 'Sets']);
		await page.getByRole('button', { name: 'More' }).click();
		await sheet.getByRole('button', { name: 'View settings' }).click();
		await page
			.getByRole('dialog', { name: 'View settings' })
			.getByRole('button', { name: 'Move left' })
			.click();
		await expect(views).toHaveText(['Grid', 'Entry', 'Sets', 'Volume']);
	});

	test('sort lives in view settings and can be removed', async ({ page, context, account }) => {
		void account;
		const { path } = await seedGym(context.request);
		await page.goto(path);

		await openField(page, 'Kg');
		await expect(page.getByRole('dialog').getByRole('button', { name: /^Sort/u })).toHaveCount(0);
		await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();

		const firstRow = page.locator('tbody tr').first();
		const openSettings = async (): Promise<Locator> => {
			await page.getByRole('button', { name: 'More' }).click();
			await page.getByRole('dialog').getByRole('button', { name: 'View settings' }).click();
			return page.getByRole('dialog', { name: 'View settings' });
		};

		let sheet = await openSettings();
		await sheet.getByRole('combobox', { name: 'Sort by' }).selectOption({ label: 'Kg' });
		await sheet.getByRole('combobox', { name: 'Order' }).selectOption('desc');
		await sheet.getByRole('button', { name: 'Save' }).click();
		await expect(firstRow).toContainText('100');
		await expect(header(page, 'Kg').locator('svg')).toBeVisible();

		await headerButton(page, 'Undo').click();
		await expect(header(page, 'Kg').locator('svg')).toHaveCount(0);
		await headerButton(page, 'Redo').click();
		await expect(header(page, 'Kg').locator('svg')).toBeVisible();

		sheet = await openSettings();
		await expect(sheet.getByRole('combobox', { name: 'Sort by' })).toHaveValue(/^f_/u);
		await sheet
			.getByRole('combobox', { name: 'Sort by' })
			.selectOption({ label: 'None, oldest first' });
		await sheet.getByRole('button', { name: 'Save' }).click();
		await expect(header(page, 'Kg').locator('svg')).toHaveCount(0);
	});

	test('a view changes type and keeps its place', async ({ page, context, account }) => {
		void account;
		const { path, list } = await seedGym(context.request);
		await page.goto(`${path}?v=${list}`);
		await page.getByRole('button', { name: 'More' }).click();
		await page.getByRole('dialog').getByRole('button', { name: 'View settings' }).click();

		const sheet = page.getByRole('dialog', { name: 'View settings' });
		await sheet.getByRole('button', { name: /^Chart/u }).click();
		await sheet.getByRole('button', { name: 'Save' }).click();

		await expect(page).toHaveURL(new RegExp(`v=${list}`, 'u'));
		await expect(page.getByRole('img', { name: /per Date/u })).toBeVisible();
		await headerButton(page, 'Undo').click();
		await expect(page.getByRole('img', { name: /per Date/u })).toHaveCount(0);
	});

	test('view settings show what the view does when nothing was set', async ({
		page,
		context,
		account
	}) => {
		void account;
		const { path, list, chart } = await seedGym(context.request);
		const dialog = page.getByRole('dialog');
		const open = async (): Promise<Locator> => {
			await page.getByRole('button', { name: 'More' }).click();
			await dialog.getByRole('button', { name: 'View settings' }).click();
			return page.getByRole('dialog', { name: 'View settings' });
		};

		await page.goto(`${path}?v=${list}`);
		let sheet = await open();
		await expect(sheet.getByRole('combobox', { name: 'Group by' })).toHaveValue('auto');
		await expect(sheet.getByRole('option', { name: 'Automatic (Date)' })).toBeAttached();
		await expect(sheet.getByRole('checkbox', { name: 'Kg' })).toBeChecked();
		await expect(sheet.getByRole('checkbox', { name: 'Reps' })).toBeChecked();
		await expect(sheet.getByRole('checkbox', { name: 'Date' })).not.toBeChecked();

		await sheet.getByRole('combobox', { name: 'Group by' }).selectOption('');
		await sheet.getByRole('button', { name: 'Save' }).click();
		await expect(page.getByRole('heading', { level: 2 })).toHaveCount(0);

		await page.goto(`${path}?v=${chart}`);
		sheet = await open();
		await expect(sheet.getByRole('combobox', { name: 'Horizontal axis' })).toHaveValue(/^f_/u);
		await expect(
			sheet.getByRole('combobox', { name: 'Horizontal axis' }).locator('option:checked')
		).toHaveText('Date');
	});

	test('view settings name the filter the header set, and clear it', async ({
		page,
		context,
		account
	}) => {
		void account;
		const { path } = await seedGym(context.request);
		await page.goto(path);
		await expect(cell(page, 'Squat')).toBeVisible();

		await header(page, 'Exercise').getByRole('button').click();
		await page.getByRole('textbox', { name: 'Filter Exercise' }).fill('squ');
		await page.keyboard.press('Enter');
		await expect(cell(page, 'Bench')).toHaveCount(0);

		await page.getByRole('button', { name: 'More' }).click();
		await page.getByRole('dialog').getByRole('button', { name: 'View settings' }).click();
		const sheet = page.getByRole('dialog', { name: 'View settings' });
		await expect(sheet.getByText('Only rows where Exercise contains "squ"')).toBeVisible();
		await sheet.getByRole('button', { name: 'Clear filter' }).click();
		await sheet.getByRole('button', { name: 'Save' }).click();
		await expect(cell(page, 'Bench')).toBeVisible();
	});

	test('a new view with no name gets one of its own', async ({ page, context, account }) => {
		void account;
		const { path } = await seedGym(context.request);
		await page.goto(path);
		await page.getByRole('button', { name: 'More' }).click();
		await page.getByRole('dialog').getByRole('button', { name: 'New view' }).click();
		await page
			.getByRole('dialog', { name: 'New view' })
			.getByRole('button', { name: 'Create' })
			.click();

		await expect(
			page.getByRole('group', { name: 'Views' }).getByRole('link', { name: 'Grid 2' })
		).toBeVisible();
	});

	test('Enter submits every sheet', async ({ page, context, account }) => {
		void account;
		const { path } = await seedGym(context.request);
		await page.goto(path);
		const dialog = page.getByRole('dialog');

		await page.getByRole('button', { name: 'Add row' }).click();
		await dialog.getByLabel('Reps').fill('9');
		await dialog.getByLabel('Reps').press('Enter');
		await expect(dialog).toHaveCount(0);
		await expect(cell(page, '9')).toBeVisible();

		await openField(page, 'Reps');
		await dialog.getByLabel('Name').fill('Repetitions');
		await dialog.getByLabel('Name').press('Enter');
		await expect(dialog).toHaveCount(0);
		await expect(header(page, 'Repetitions')).toBeVisible();

		await page.getByRole('button', { name: 'More' }).click();
		await dialog.getByRole('button', { name: 'View settings' }).click();
		const settings = page.getByRole('dialog', { name: 'View settings' });
		await settings.getByLabel('Name').fill('Sheet');
		await settings.getByLabel('Name').press('Enter');
		await expect(dialog).toHaveCount(0);
		await expect(
			page.getByRole('group', { name: 'Views' }).getByRole('link', { name: 'Sheet' })
		).toBeVisible();

		await page.getByRole('group', { name: 'Tables' }).getByRole('link', { name: 'All' }).click();
		await page.getByRole('button', { name: 'New base' }).click();
		await dialog.getByRole('textbox', { name: 'New base' }).fill('Money');
		await dialog.getByRole('textbox', { name: 'New base' }).press('Enter');
		await expect(page.getByRole('heading', { name: 'Money', level: 2 })).toBeVisible();
	});
});

test.describe('importing', () => {
	test('a CSV appends to a table through a column mapping, in one undo step', async ({
		page,
		context,
		account
	}) => {
		void account;
		const { path } = await seedGym(context.request);
		await page.goto(path);
		await expect(page.getByText('2 rows')).toBeVisible();

		await page.getByRole('button', { name: 'More' }).click();
		await page.getByRole('dialog').getByRole('button', { name: 'Import into this table' }).click();
		const sheet = page.getByRole('dialog', { name: 'Import' });
		await sheet.getByLabel('File to import').setInputFiles({
			name: 'more.csv',
			mimeType: 'text/csv',
			buffer: Buffer.from(
				'date,EXERCISE,weight,reps,place\n2026-10-25,Deadlift,140,3,Gym A\n2026-10-26,Squat,105,lots,Gym B\n'
			)
		});

		await expect(sheet.getByText('5 columns, 2 rows')).toBeVisible();
		const target = (name: string): Locator =>
			sheet.getByRole('combobox', { name: `Field for ${name}` });
		await expect(target('date').locator('option:checked')).toHaveText('Date');
		await expect(target('EXERCISE').locator('option:checked')).toHaveText('Exercise');
		await expect(target('reps').locator('option:checked')).toHaveText('Reps');
		await expect(target('place').locator('option:checked')).toHaveText('New field');
		await expect(target('weight').locator('option:checked')).toHaveText('New field');
		await target('weight').selectOption({ label: 'Kg' });
		await target('place').selectOption({ label: 'Skip' });
		await sheet.getByRole('button', { name: 'Import' }).click();

		await expect(page.getByText('4 rows')).toBeVisible();
		await expect(page.getByRole('status')).toContainText('1 value left empty');
		await expect(cell(page, 'Deadlift')).toBeVisible();
		await expect(cell(page, '140')).toBeVisible();
		await expect(header(page, 'weight')).toHaveCount(0);
		await expect(header(page, 'place')).toHaveCount(0);

		await headerButton(page, 'Undo').click();
		await expect(page.getByText('2 rows', { exact: true })).toBeVisible();
		await expect(cell(page, 'Deadlift')).toHaveCount(0);
		await headerButton(page, 'Redo').click();
		await expect(page.getByText('4 rows')).toBeVisible();
		await expect(cell(page, 'Deadlift')).toBeVisible();
	});

	test('a file dropped on a table goes into that table, or a new one', async ({
		page,
		context,
		account
	}) => {
		void account;
		const { path } = await seedGym(context.request);
		await page.goto(path);
		await expect(page.getByText('2 rows')).toBeVisible();

		await dropFile(page, 'rows.csv', 'Reps\n7\n');
		const sheet = page.getByRole('dialog', { name: 'Import' });
		await expect(
			sheet.getByRole('combobox', { name: 'Field for Reps' }).locator('option:checked')
		).toHaveText('Reps');

		await sheet.getByRole('combobox', { name: 'Into' }).selectOption({ label: 'A new table' });
		await expect(sheet.getByRole('textbox', { name: 'Table name' })).toHaveValue('rows');
		await sheet.getByRole('button', { name: 'Import' }).click();
		await expect(page.getByRole('heading', { name: 'rows' })).toBeVisible();
	});

	test('an import that creates the base is one undo step', async ({ page, account }) => {
		void account;
		await page.goto('/app');
		await expect(page.getByText('No tables yet.')).toBeVisible();

		await dropFile(page, 'weigh-ins.csv', 'date,kg\n2026-10-30,81.5\n');
		await page
			.getByRole('dialog', { name: 'Import' })
			.getByRole('button', { name: 'Import' })
			.click();
		await expect(page.getByRole('heading', { name: 'weigh-ins' })).toBeVisible();

		await headerButton(page, 'Undo').click();
		await expect(headerButton(page, 'Undo')).toBeDisabled();
		await page.getByRole('group', { name: 'Tables' }).getByRole('link', { name: 'All' }).click();
		await expect(page.getByText('No tables yet.')).toBeVisible();
		await expect(page.getByRole('heading', { level: 2 })).toHaveCount(0);
	});

	async function exportTo(page: Page, file: string): Promise<void> {
		await page.goto('/app/settings');
		await expect(
			page.getByRole('group', { name: 'Tables' }).getByRole('link', { name: 'Lifts' })
		).toBeVisible();
		const downloading = page.waitForEvent('download');
		await page.getByRole('button', { name: 'Export as JSON' }).click();
		await (await downloading).saveAs(file);
	}

	test('a JSON export comes back on a device holding nothing', async ({
		page,
		context,
		account,
		browser
	}, info) => {
		void account;
		await seedGym(context.request);
		const file = info.outputPath('export.json');
		await exportTo(page, file);

		const device = await browser.newContext({
			baseURL: info.project.use.baseURL,
			viewport: info.project.use.viewport,
			locale: 'en-US'
		});
		await signIn(device, newAccount());
		const other = await device.newPage();
		await other.goto('/app/settings');
		await other.getByRole('button', { name: 'Import' }).click();
		const sheet = other.getByRole('dialog', { name: 'Import' });

		await sheet.getByLabel('File to import').setInputFiles({
			name: 'other.json',
			mimeType: 'application/json',
			buffer: Buffer.from('{"format":"other"}')
		});
		await expect(sheet.getByRole('alert')).toHaveText('This file isn’t a Torsel export.');

		await sheet.getByLabel('File to import').setInputFiles(file);
		await expect(sheet.getByText('This export holds 1 table, 2 rows.')).toBeVisible();
		await sheet.getByRole('button', { name: 'Restore' }).click();

		const tabs = other.getByRole('group', { name: 'Tables' });
		await tabs.getByRole('link', { name: 'Lifts' }).click();
		await expect(other.getByText('2 rows')).toBeVisible();
		await expect(other.getByRole('gridcell', { name: 'Squat' })).toBeVisible();
		await device.close();
	});

	test('a deleted table returns from its JSON export, and undo removes it again', async ({
		page,
		context,
		account
	}, info) => {
		void account;
		const { path } = await seedGym(context.request);
		const file = info.outputPath('export.json');
		await exportTo(page, file);

		await page.goto(path);
		await page.getByRole('button', { name: 'More' }).click();
		await page.getByRole('dialog').getByRole('button', { name: 'Delete table' }).click();
		await expect(page).toHaveURL(/\/app$/u);
		await expect(
			page.getByRole('group', { name: 'Tables' }).getByRole('link', { name: 'Lifts' })
		).toHaveCount(0);

		await page.getByRole('button', { name: 'Import a file' }).click();
		const sheet = page.getByRole('dialog', { name: 'Import' });
		await sheet.getByLabel('File to import').setInputFiles(file);
		await expect(sheet.getByText('This export holds 1 table, 2 rows.')).toBeVisible();
		await page.keyboard.press('Enter');
		await expect(
			page.getByRole('group', { name: 'Tables' }).getByRole('link', { name: 'Lifts' })
		).toBeVisible();

		await headerButton(page, 'Undo').click();
		await expect(
			page.getByRole('group', { name: 'Tables' }).getByRole('link', { name: 'Lifts' })
		).toHaveCount(0);
	});

	test('the kilorep export makes a table you can log into', async ({ page, account }) => {
		void account;
		const rows = kilorepExport();
		await page.goto('/app');
		await expect(page.getByText('No tables yet.')).toBeVisible();

		await dropFile(page, 'kilorep-sets-2026-10-31.csv', rows.csv);
		const sheet = page.getByRole('dialog', { name: 'Import' });
		await expect(sheet.getByText(`14 columns, ${rows.count} rows`)).toBeVisible();
		const type = (name: string): Locator =>
			sheet.getByRole('combobox', { name: `Type of ${name}` });
		await expect(type('date')).toHaveValue('date');
		await expect(type('workout')).toHaveValue('choice');
		await expect(type('exercise')).toHaveValue('choice');
		await expect(type('weight_kg')).toHaveValue('number');
		await expect(type('reps')).toHaveValue('number');
		await expect(type('rpe')).toHaveValue('number');
		await expect(type('completed')).toHaveValue('check');
		await expect(type('note')).toHaveValue('text');
		await page.keyboard.press('Enter');

		await expect(page.getByRole('heading', { name: 'kilorep-sets-2026-10-31' })).toBeVisible();
		await expect(page.getByText(`${rows.count} rows`, { exact: true })).toBeVisible();

		await expect(header(page, 'load_mode')).toBeAttached();

		await page.getByRole('group', { name: 'Views' }).getByRole('link', { name: 'Entry' }).click();
		const lastTime = page.getByText(/^Last time/u);
		await expect(lastTime).toContainText('Oct 28');
		await expect(page.getByRole('button', { name: 'Add row' })).toBeInViewport();
		await expect(page.getByRole('button', { name: 'weight_kg plus' })).toBeInViewport();
		await expect(page.getByRole('button', { name: 'reps plus' })).toBeInViewport();
		await expect(page.getByText('load_mode')).toHaveCount(0);
		await expect(page.getByRole('textbox', { name: 'grip' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Dip', exact: true })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		await page.getByRole('button', { name: 'Add row' }).click();
		await expect(page.getByText(`${rows.count + 1} rows`, { exact: true })).toBeVisible();
		await expect(lastTime).toContainText('Oct 28');
	});
});

test.describe('the audit’s core jobs, at or below their old count', () => {
	test('create a table: was 3', async ({ page, account }) => {
		void account;
		await page.goto('/app');
		await expect(page.getByText('No tables yet.')).toBeVisible();
		const taps = await countTaps(page);

		await page.getByRole('button', { name: 'New table' }).last().click();
		await expect(page.getByRole('textbox', { name: 'Table name' })).toBeFocused();
		expect(await taps()).toBeLessThanOrEqual(3);
		expect(await taps()).toBe(1);
	});

	test('add a row: was 2 on the grid and in Entry', async ({ page, context, account }) => {
		void account;
		const { path, entry } = await seedGym(context.request);
		await page.goto(path);
		await expect(page.getByText('2 rows')).toBeVisible();
		let taps = await countTaps(page);

		await page.getByRole('button', { name: 'Add row' }).click();
		await page.keyboard.press('Enter');
		await expect(page.getByText('3 rows')).toBeVisible();
		expect(await taps()).toBe(1);

		await page.goto(`${path}?v=${entry}`);
		await expect(page.getByRole('button', { name: 'Add row' })).toBeVisible();
		taps = await countTaps(page);
		await page.getByRole('button', { name: 'Add row' }).click();
		await expect(page.getByText('4 rows')).toBeVisible();
		expect(await taps()).toBe(1);
	});

	test('edit a cell: was 2 for text and 3 for a choice', async ({ page, context, account }) => {
		void account;
		const { path } = await seedGym(context.request);
		await page.goto(path);
		await expect(cell(page, '100')).toBeVisible();
		const taps = await countTaps(page);

		await editCell(page, '100', '110');
		expect(await taps()).toBeLessThanOrEqual(2);
	});

	test('add a field: was 3, and 5 with a type', async ({ page, context, account }) => {
		void account;
		const { path } = await seedGym(context.request);
		await page.goto(path);
		await expect(cell(page, '100')).toBeVisible();
		const taps = await countTaps(page);

		await page.getByRole('button', { name: 'Add a field' }).click();
		await page.getByRole('textbox', { name: 'Field name' }).fill('RPE');
		await page.keyboard.press('Enter');
		await expect(header(page, 'RPE')).toBeVisible();
		expect(await taps()).toBe(1);

		await page.getByRole('textbox', { name: 'Field name' }).fill('Done');
		await page.getByRole('combobox', { name: 'Field type' }).selectOption('check');
		await page.getByRole('button', { name: 'Add', exact: true }).click();
		await expect(header(page, 'Done')).toBeVisible();
		expect(await taps()).toBeLessThanOrEqual(5);
	});

	test('switch view: was 1', async ({ page, context, account }) => {
		void account;
		const { path } = await seedGym(context.request);
		await page.goto(path);
		await expect(cell(page, '100')).toBeVisible();
		const taps = await countTaps(page);

		await page.getByRole('group', { name: 'Views' }).getByRole('link', { name: 'Entry' }).click();
		await expect(page.getByRole('button', { name: 'Add row' })).toBeVisible();
		expect(await taps()).toBe(1);
	});

	test('create a view: was 3', async ({ page, context, account }) => {
		void account;
		const { path } = await seedGym(context.request);
		await page.goto(path);
		await expect(cell(page, '100')).toBeVisible();
		const taps = await countTaps(page);

		if (onPhone()) {
			await page.getByRole('button', { name: 'More' }).click();
			await page.getByRole('dialog').getByRole('button', { name: 'New view' }).click();
		} else {
			await page.getByRole('button', { name: 'New view' }).click();
		}
		await page.keyboard.press('Enter');
		await expect(
			page.getByRole('group', { name: 'Views' }).getByRole('link', { name: 'Grid 2' })
		).toBeVisible();
		expect(await taps()).toBeLessThanOrEqual(3);
	});

	test('import a CSV: was 5', async ({ page, account }) => {
		void account;
		await page.goto('/app');
		await expect(page.getByText('No tables yet.')).toBeVisible();
		const taps = await countTaps(page);

		await page.getByRole('button', { name: 'Import a file' }).click();
		await page.getByLabel('File to import').setInputFiles({
			name: 'weigh-ins.csv',
			mimeType: 'text/csv',
			buffer: Buffer.from('date,kg\n2026-10-30,81.5\n')
		});
		await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
		await expect(page.getByRole('heading', { name: 'weigh-ins' })).toBeVisible();
		expect(await taps()).toBeLessThanOrEqual(5);
	});

	test('undo: was the toast within 6s on a phone', async ({ page, context, account }) => {
		void account;
		const { path } = await seedGym(context.request);
		await page.goto(path);
		await editCell(page, '100', '110');
		await page.waitForTimeout(100);
		const taps = await countTaps(page);

		await headerButton(page, 'Undo').click();
		await expect(cell(page, '100')).toBeVisible();
		expect(await taps()).toBe(1);
	});
});

test.describe('a boot the server does not answer', () => {
	test('asks again without any online event, then syncs what was changed', async ({
		page,
		context,
		account
	}) => {
		void account;
		const { path } = await seedGym(context.request);
		await page.goto(path);
		await expect(cell(page, '100')).toBeVisible();

		await page.route('**/api/auth/session', (route) => route.abort('internetdisconnected'));
		await page.route('**/api/sync', (route) => route.abort('internetdisconnected'));
		await page.reload();
		await expect(cell(page, '100')).toBeVisible();
		await expect(page.getByRole('button', { name: /^Ask/u })).toHaveCount(0);

		await editCell(page, '100', '123.5');
		await expect(page.getByRole('status')).toHaveText('Offline, 1 change waiting');

		await page.unroute('**/api/auth/session');
		await page.unroute('**/api/sync');
		await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

		await expect(page.getByRole('button', { name: /^Ask/u })).toBeVisible();
		await expect(page.getByRole('status')).toHaveCount(0);
		await expect
			.poll(async () => {
				const response = await context.request.post('/api/sync', {
					...RETRY_RESET,
					data: { watermark: 0, push: [] }
				});
				return JSON.stringify(await response.json());
			})
			.toContain('123.5');
	});

	test('recovers from a server error the same way', async ({ page, context, account }) => {
		void account;
		const { path } = await seedGym(context.request);
		await page.route('**/api/auth/session', (route) => route.fulfill({ status: 400, json: {} }));
		await page.goto(path);
		await expect(page.getByRole('status')).toContainText('Sync failed');

		await page.unroute('**/api/auth/session');
		await page.evaluate(() => window.dispatchEvent(new Event('online')));
		await expect(page.getByRole('status')).toHaveCount(0);
		await expect(page.getByRole('button', { name: /^Ask/u })).toBeVisible();
	});
});

function kilorepExport(): { csv: string; count: number } {
	const header =
		'date,workout,exercise,set,type,weight_kg,load_mode,reps,rpe,grip,arms,completed,load_kg,note';
	const days = ['2026-10-28', '2026-10-26', '2026-10-24', '2026-10-21', '2026-10-19'];
	const lifts = ['Bench Press', 'Row', 'Squat', 'Lateral Raise', 'Dip'];
	const lines = days.flatMap((day, d) =>
		lifts.flatMap((lift, l) =>
			[1, 2, 3, 4].map((set) =>
				[
					day,
					d % 2 === 0 ? 'Push A' : 'Pull A',
					lift,
					set,
					'normal',
					60 + l * 10 - d * 2.5,
					'total',
					8 + (set % 3),
					set === 4 ? '8.5' : '',
					'',
					'both',
					'true',
					'',
					set === 1 && l === 0 ? `"seat ${d + 3}, low"` : ''
				].join(',')
			)
		)
	);
	return { csv: `${[header, ...lines].join('\r\n')}\r\n`, count: lines.length };
}
