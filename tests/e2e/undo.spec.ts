import type { APIRequestContext, Locator, Page } from '@playwright/test';

import { createBase, createTable, createView, insertRows } from '../../src/lib/core/actions.ts';
import { expect, seed, test } from './harness.ts';

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
		return `/app/t/${lifts.id}`;
	});
}

const undoButton = (page: Page): Locator => page.getByRole('button', { name: 'Undo', exact: true });
const redoButton = (page: Page): Locator => page.getByRole('button', { name: 'Redo', exact: true });

/** Undo puts `before` back and redo brings `after` back, through the header both viewports share. */
async function undoAndRedo(page: Page, before: Locator, after: Locator): Promise<void> {
	await expect(after).toBeVisible();
	await undoButton(page).first().click();
	await expect(before).toBeVisible();
	await expect(after).toHaveCount(0);
	await redoButton(page).click();
	await expect(after).toBeVisible();
	await expect(before).toHaveCount(0);
}

/** How many steps the device has written down: a reload before that would lose the last one. */
function stored(page: Page, stack: 'undo' | 'redo'): Promise<number> {
	return page.evaluate(
		(key) =>
			new Promise<number>((resolve) => {
				const open = indexedDB.open('torsel');
				open.onsuccess = () => {
					const get = open.result.transaction('meta').objectStore('meta').get('history');
					get.onsuccess = () => {
						open.result.close();
						resolve(get.result?.[key]?.length ?? 0);
					};
				};
			}),
		stack
	);
}

async function openField(page: Page, name: string): Promise<Locator> {
	await page.getByRole('columnheader', { name }).getByRole('button').click();
	await page.getByRole('button', { name: 'Field settings' }).click();
	return page.getByRole('dialog');
}

async function openMenu(page: Page): Promise<Locator> {
	await page.getByRole('button', { name: 'More' }).click();
	return page.getByRole('dialog');
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
	await undoAndRedo(
		page,
		page.getByRole('gridcell', { name: '100' }),
		page.getByRole('gridcell', { name: '120' })
	);

	await page.getByRole('button', { name: 'Add row' }).click();
	await sheet.getByLabel('Exercise').fill('Deadlift');
	await sheet.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByRole('gridcell', { name: 'Deadlift' })).toBeVisible();
	await undoButton(page).first().click();
	await expect(page.getByRole('gridcell', { name: 'Deadlift' })).toHaveCount(0);
});

test('a deleted row, with no question asked', async ({ page }) => {
	await page.getByRole('button', { name: 'Open row' }).first().click();
	await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect(page.getByRole('gridcell', { name: 'Squat' })).toHaveCount(0);
	await undoButton(page).first().click();
	await expect(page.getByRole('gridcell', { name: 'Squat' })).toBeVisible();
	await redoButton(page).click();
	await expect(page.getByRole('gridcell', { name: 'Squat' })).toHaveCount(0);
});

test('a field renamed, then deleted', async ({ page }) => {
	const sheet = await openField(page, 'Kg');
	await sheet.getByLabel('Name').fill('Load');
	await sheet.getByRole('button', { name: 'Save' }).click();
	await undoAndRedo(
		page,
		page.getByRole('columnheader', { name: 'Kg' }),
		page.getByRole('columnheader', { name: 'Load' })
	);

	await openField(page, 'Load');
	await sheet.getByRole('button', { name: 'Delete' }).click();
	await expect(sheet).toHaveCount(0);
	await expect(page.getByRole('columnheader', { name: 'Load' })).toHaveCount(0);
	await undoButton(page).first().click();
	await expect(page.getByRole('columnheader', { name: 'Load' })).toBeVisible();
});

test('a field added from the header', async ({ page }) => {
	await page.getByRole('button', { name: 'Add a field' }).click();
	await page.getByRole('textbox', { name: 'Field name' }).fill('RPE');
	await page.keyboard.press('Enter');
	await page.keyboard.press('Escape');
	const added = page.getByRole('columnheader', { name: 'RPE' });
	await expect(added).toBeVisible();
	await undoButton(page).first().click();
	await expect(added).toHaveCount(0);
	await redoButton(page).click();
	await expect(added).toBeVisible();
});

test('a view added, then deleted', async ({ page }) => {
	const views = page.getByRole('group', { name: 'Views' });

	const sheet = await openMenu(page);
	await sheet.getByRole('button', { name: 'New view' }).click();
	await sheet.getByRole('button', { name: /^Chart/u }).click();
	await sheet.getByRole('button', { name: 'Create' }).click();
	await expect(views.getByRole('link', { name: 'Chart' })).toBeVisible();
	await undoButton(page).first().click();
	await expect(views.getByRole('link', { name: 'Chart' })).toHaveCount(0);
	await redoButton(page).click();
	await expect(views.getByRole('link', { name: 'Chart' })).toBeVisible();

	await views.getByRole('link', { name: 'Chart' }).click();
	await openMenu(page);
	await sheet.getByRole('button', { name: 'View settings' }).click();
	await page
		.getByRole('dialog', { name: 'View settings' })
		.getByRole('button', { name: 'Delete' })
		.click();
	await expect(views.getByRole('link', { name: 'Chart' })).toHaveCount(0);
	await undoButton(page).first().click();
	await expect(views.getByRole('link', { name: 'Chart' })).toBeVisible();
});

test('a table deleted, and a base deleted', async ({ page }) => {
	const tabs = page.getByRole('group', { name: 'Tables' });

	const sheet = await openMenu(page);
	await sheet.getByRole('button', { name: 'Delete table' }).click();
	await expect(page).toHaveURL(/\/app$/u);
	await expect(tabs.getByRole('link', { name: 'Lifts' })).toHaveCount(0);
	await undoButton(page).first().click();
	await expect(tabs.getByRole('link', { name: 'Lifts' })).toBeVisible();

	const money = page.locator('div').filter({ has: page.getByRole('heading', { name: 'Money' }) });
	await money.last().getByRole('button', { name: 'Delete' }).click();
	await expect(tabs.getByRole('link', { name: 'Expenses' })).toHaveCount(0);
	await undoButton(page).first().click();
	await expect(tabs.getByRole('link', { name: 'Expenses' })).toBeVisible();
	await redoButton(page).click();
	await expect(tabs.getByRole('link', { name: 'Expenses' })).toHaveCount(0);
});

test('a fresh change clears redo, and the keyboard reaches both', async ({ page }) => {
	test.skip(test.info().project.name === 'phone', 'a phone has no keyboard shortcut');

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
	await expect(redoButton(page)).toBeEnabled();
	await page.getByRole('button', { name: 'Open row' }).first().click();
	await page.getByRole('dialog').getByLabel('Kg').fill('90');
	await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
	await expect(redoButton(page)).toBeDisabled();
});

test('the history survives a reload', async ({ page }) => {
	await page.getByRole('gridcell', { name: 'Squat' }).dblclick();
	const editor = page.getByRole('gridcell').getByRole('textbox');
	await editor.fill('Bench');
	await editor.press('Enter');
	await expect(page.getByRole('gridcell', { name: 'Bench' })).toBeVisible();

	await expect.poll(() => stored(page, 'undo')).toBe(1);

	await page.reload();
	await expect(page.getByRole('gridcell', { name: 'Bench' })).toBeVisible();
	await undoButton(page).first().click();
	await expect(page.getByRole('gridcell', { name: 'Squat' })).toBeVisible();
	await expect.poll(() => stored(page, 'redo')).toBe(1);
	await page.reload();
	await expect(page.getByRole('gridcell', { name: 'Squat' })).toBeVisible();
	await redoButton(page).click();
	await expect(page.getByRole('gridcell', { name: 'Bench' })).toBeVisible();
});
