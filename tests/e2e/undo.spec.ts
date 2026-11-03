import type { APIRequestContext, Locator, Page } from '@playwright/test';

import { createBase, createTable, createView, insertRows } from '../../src/lib/core/actions.ts';
import {
	columnMenu,
	expect,
	expectListed,
	redo,
	script,
	seed,
	tableMenu,
	tablePath,
	test,
	toastButton,
	undo
} from './harness.ts';

function seedLifts(request: APIRequestContext) {
	return seed(request, (ws, commit) => {
		const base = createBase(ws, 'Gym');
		commit(base.changes);
		const lifts = createTable(ws, base.id, 'Lifts', [
			{ name: 'Exercise', type: 'text' },
			{ name: 'Kg', type: 'number' }
		]);
		commit(lifts.changes);
		commit(
			insertRows(ws, lifts.id, [{ [lifts.fieldIds[0]]: 'Squat', [lifts.fieldIds[1]]: 100 }]).changes
		);
		commit(createView(ws, lifts.id, { name: 'Sessions', type: 'list', config: {} }).changes);
		const other = createBase(ws, 'Money');
		commit(other.changes);
		commit(createTable(ws, other.id, 'Expenses', [{ name: 'Amount', type: 'number' }]).changes);
		return tablePath(lifts.id);
	});
}

/** Undo puts `before` back and redo brings `after` back, from the keyboard. */
async function undoAndRedo(page: Page, before: Locator, after: Locator): Promise<void> {
	await expect(after).toBeVisible();
	await undo(page);
	await expect(before).toBeVisible();
	await expect(after).toHaveCount(0);
	await redo(page);
	await expect(after).toBeVisible();
	await expect(before).toHaveCount(0);
}

/** The same through the toasts both viewports share: Undo in the change's, Redo in the undo's. */
async function undoAndRedoInToast(page: Page, before: Locator, after: Locator): Promise<void> {
	await expect(after).toBeVisible();
	await toastButton(page, 'Undo').click();
	await expect(before).toBeVisible();
	await expect(after).toHaveCount(0);
	await toastButton(page, 'Redo').click();
	await expect(after).toBeVisible();
	await expect(before).toHaveCount(0);
}

async function openField(page: Page, name: string): Promise<Locator> {
	await columnMenu(page, name, 'Field settings');
	return page.getByRole('dialog', { name: 'Field', exact: true });
}

test.beforeEach(async ({ page, context, account }) => {
	void account;
	await page.goto(await seedLifts(context.request));
	await expect(page.getByRole('gridcell', { name: 'Squat' })).toBeVisible();
});

test('a cell edit', async ({ page }) => {
	await page.getByRole('gridcell', { name: 'Squat' }).dblclick();
	const editor = page.getByRole('gridcell').getByRole('textbox');
	await editor.fill('Bench');
	await editor.press('Enter');
	await expect(page.getByRole('gridcell', { name: 'Bench' })).toBeVisible();
	if (test.info().project.name === 'desktop') {
		await expect(
			toastButton(page, 'Undo'),
			'with Ctrl+Z at hand, a cell commit is quiet'
		).toHaveCount(0);
	}
	await undoAndRedo(
		page,
		page.getByRole('gridcell', { name: 'Squat' }),
		page.getByRole('gridcell', { name: 'Bench' })
	);
});

test('a row edited in its sheet, and a new row', async ({ page }) => {
	await page.getByRole('button', { name: 'Open row' }).first().click();
	const sheet = page.getByRole('dialog');
	await sheet.getByLabel('Kg').fill('120');
	await sheet.getByRole('button', { name: 'Save' }).click();
	await undoAndRedoInToast(
		page,
		page.getByRole('gridcell', { name: '100' }),
		page.getByRole('gridcell', { name: '120' })
	);

	await page.getByRole('button', { name: 'Add row' }).click();
	await sheet.getByLabel('Exercise').fill('Deadlift');
	await sheet.getByRole('button', { name: 'Save' }).click();
	const added = page.getByRole('gridcell', { name: 'Deadlift' });
	await expect(added).toBeVisible();
	await toastButton(page, 'Undo').click();
	await expect(added).toHaveCount(0);
	await toastButton(page, 'Redo').click();
	await expect(added).toBeVisible();
});

test('a deleted row, with no question asked', async ({ page }) => {
	await page.getByRole('button', { name: 'Open row' }).first().click();
	await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect(page.getByRole('gridcell', { name: 'Squat' })).toHaveCount(0);
	await toastButton(page, 'Undo').click();
	await expect(page.getByRole('gridcell', { name: 'Squat' })).toBeVisible();
	await toastButton(page, 'Redo').click();
	await expect(page.getByRole('gridcell', { name: 'Squat' })).toHaveCount(0);
});

test('a field renamed, then deleted', async ({ page }) => {
	const sheet = await openField(page, 'Kg');
	await sheet.getByLabel('Name').fill('Load');
	await sheet.getByRole('button', { name: 'Save' }).click();
	await undoAndRedoInToast(
		page,
		page.getByRole('columnheader', { name: 'Kg' }),
		page.getByRole('columnheader', { name: 'Load' })
	);

	await openField(page, 'Load');
	await sheet.getByRole('button', { name: 'Delete' }).click();
	await expect(sheet).toHaveCount(0);
	await expect(page.getByRole('columnheader', { name: 'Load' })).toHaveCount(0);
	await toastButton(page, 'Undo').click();
	await expect(page.getByRole('columnheader', { name: 'Load' })).toBeVisible();
});

test('a field added from the header', async ({ page }) => {
	await page.getByRole('button', { name: 'Add a field' }).click();
	await page.getByRole('textbox', { name: 'Field name' }).fill('RPE');
	await page.keyboard.press('Enter');
	await page.keyboard.press('Escape');
	const added = page.getByRole('columnheader', { name: 'RPE' });
	await expect(added).toBeVisible();
	await toastButton(page, 'Undo').click();
	await expect(added).toHaveCount(0);
	await toastButton(page, 'Redo').click();
	await expect(added).toBeVisible();
});

test('a sort, from its toast', async ({ page }) => {
	const kg = page.getByRole('columnheader', { name: 'Kg' });
	await kg.getByRole('button').click();
	await page.getByRole('button', { name: 'Sort descending' }).click();
	await expect(kg).toHaveAttribute('aria-sort', 'descending');
	await expect(page.getByRole('status')).toContainText('Sort changed');
	await toastButton(page, 'Undo').click();
	await expect(kg).not.toHaveAttribute('aria-sort');
	await toastButton(page, 'Redo').click();
	await expect(kg).toHaveAttribute('aria-sort', 'descending');
});

test('a view added, then deleted', async ({ page }) => {
	const views = page.getByRole('group', { name: 'Views' });

	const sheet = page.getByRole('dialog');
	await tableMenu(page, 'New view');
	await sheet.getByRole('button', { name: /^Chart/u }).click();
	await sheet.getByRole('button', { name: 'Create' }).click();
	await expect(views.getByRole('link', { name: 'Chart' })).toBeVisible();
	await toastButton(page, 'Undo').click();
	await expect(views.getByRole('link', { name: 'Chart' })).toHaveCount(0);
	await toastButton(page, 'Redo').click();
	await expect(views.getByRole('link', { name: 'Chart' })).toBeVisible();

	await views.getByRole('link', { name: 'Chart' }).click();
	await tableMenu(page, 'View settings');
	await page
		.getByRole('dialog', { name: 'View settings' })
		.getByRole('button', { name: 'Delete' })
		.click();
	await expect(views.getByRole('link', { name: 'Chart' })).toHaveCount(0);
	await toastButton(page, 'Undo').click();
	await expect(views.getByRole('link', { name: 'Chart' })).toBeVisible();
});

test('a table deleted, and a base deleted', async ({ page }) => {
	await tableMenu(page, 'Delete table');
	await expect(page).toHaveURL(/\/app$/u);
	await expectListed(page, 'Lifts', 0);
	await toastButton(page, 'Undo').click();
	await expectListed(page, 'Lifts');

	const money = page.locator('div').filter({ has: page.getByRole('heading', { name: 'Money' }) });
	await money.last().getByRole('button', { name: 'Delete' }).click();
	await expectListed(page, 'Expenses', 0);
	await toastButton(page, 'Undo').click();
	await expectListed(page, 'Expenses');
	await toastButton(page, 'Redo').click();
	await expectListed(page, 'Expenses', 0);
});

test('a fresh change clears redo, and the keyboard reaches both', async ({ page }) => {
	await page.getByRole('gridcell', { name: 'Squat' }).dblclick();
	const editor = page.getByRole('gridcell').getByRole('textbox');
	await editor.fill('Bench');
	await editor.press('Enter');
	await expect(page.getByRole('gridcell', { name: 'Bench' })).toBeVisible();

	await page.keyboard.press('Control+z');
	await expect(page.getByRole('gridcell', { name: 'Squat' })).toBeVisible();
	await page.keyboard.press('Control+Shift+z');
	await expect(page.getByRole('gridcell', { name: 'Bench' })).toBeVisible();
	await page.keyboard.press('Control+z');
	await expect(page.getByRole('gridcell', { name: 'Squat' })).toBeVisible();
	await page.keyboard.press('Control+y');
	await expect(page.getByRole('gridcell', { name: 'Bench' })).toBeVisible();

	await page.keyboard.press('Control+z');
	await expect(page.getByRole('status')).toContainText('Undid: ');
	await page.getByRole('button', { name: 'Open row' }).first().click();
	await page.getByRole('dialog').getByLabel('Kg').fill('90');
	await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
	await expect(page.getByRole('gridcell', { name: '90' })).toBeVisible();
	await page.keyboard.press('Control+Shift+z');
	await expect(page.getByRole('status')).toContainText('Nothing to redo');
	await expect(page.getByRole('gridcell', { name: 'Squat' })).toBeVisible();
});

test('what the assistant applied undoes after a reload, and the model hears', async ({
	page,
	context
}) => {
	const key = await script(context.request, [
		{
			blocks: [
				{
					type: 'tool',
					id: 'toolu_add',
					name: 'add_rows',
					input: { base: 'Gym', table: 'Lifts', rows: [{ Exercise: 'Deadlift', Kg: 140 }] }
				}
			]
		},
		{ blocks: [{ type: 'text', text: 'Logged.' }] },
		{ blocks: [{ type: 'text', text: 'Understood.' }] }
	]);
	const ask = page.getByRole('button', { name: /^Ask/u });
	const close = page.locator('aside[aria-label="Ask"]').getByRole('button', { name: 'Close' });
	const thread = page.getByTestId('thread');

	await ask.click();
	await page.getByPlaceholder('Ask about your tables').fill(`${key} log a deadlift`);
	await page.getByRole('button', { name: 'Send' }).click();
	await expect(thread.getByText('Logged.')).toBeVisible();
	await close.click();
	await expect(page.getByText('2 rows')).toBeVisible();
	await page.reload();
	await ask.click();
	await expect(thread.locator('[data-status="applied"]')).toBeVisible();
	await close.click();

	await undo(page);
	await expect(page.getByText('1 row', { exact: true })).toBeVisible();
	await ask.click();
	await expect(thread.locator('[data-status="undone"]')).toBeVisible();

	await page.getByPlaceholder('Ask about your tables').fill(`${key} what is left`);
	await page.getByRole('button', { name: 'Send' }).click();
	await expect(thread.getByText('Understood.')).toBeVisible();
	const seen = await context.request.get(`${process.env.TORSEL_TEST_FAKE}/__seen?key=${key}`);
	expect(JSON.stringify((await seen.json()).requests.at(-1).messages)).toContain(
		'Undone by the person since your last reply'
	);
	await close.click();

	await redo(page);
	await expect(page.getByText('2 rows')).toBeVisible();
	await ask.click();
	await expect(thread.locator('[data-status="applied"]')).toBeVisible();
});

test('the history survives a reload', async ({ page }) => {
	await page.getByRole('gridcell', { name: 'Squat' }).dblclick();
	const editor = page.getByRole('gridcell').getByRole('textbox');
	await editor.fill('Bench');
	await editor.press('Enter');
	await expect(page.getByRole('gridcell', { name: 'Bench' })).toBeVisible();

	await page.reload();
	await expect(page.getByRole('gridcell', { name: 'Bench' })).toBeVisible();
	await undo(page);
	await expect(page.getByRole('gridcell', { name: 'Squat' })).toBeVisible();
	await page.reload();
	await expect(page.getByRole('gridcell', { name: 'Squat' })).toBeVisible();
	await redo(page);
	await expect(page.getByRole('gridcell', { name: 'Bench' })).toBeVisible();
});
