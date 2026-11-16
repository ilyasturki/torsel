import names from '../../src/lib/i18n/names.ts';
import type { APIRequestContext, Locator, Page } from '@playwright/test';

import { createBase, createTable, defaultViews, createView } from '../../src/lib/core/actions.ts';
import {
	expect,
	expectView,
	newView,
	seed,
	tablePath,
	test,
	toastButton,
	viewSettings
} from './harness.ts';

const onPhone = (): boolean => test.info().project.name === 'phone';

function seedViews(request: APIRequestContext) {
	return seed(request, (ws, commit) => {
		const base = createBase(ws, 'Gym');
		commit(base.changes);
		const sets = createTable(ws, base.id, 'Sets', [{ name: 'Kg', type: 'number' }], () =>
			defaultViews(names.en)
		);
		commit(sets.changes);
		for (const [name, type] of [
			['Trend', 'chart'],
			['Log', 'list']
		] as const) {
			commit(createView(ws, sets.id, { name, type, config: {} }).changes);
		}
		return tablePath(sets.id);
	});
}

const tabs = (page: Page): Locator => page.getByRole('group', { name: 'Views' }).getByRole('link');

/** Drags a view tab by the mouse onto another's place. */
async function dragTab(page: Page, from: string, onto: string): Promise<void> {
	const start = await tabs(page).getByText(from, { exact: true }).boundingBox();
	const end = await tabs(page).getByText(onto, { exact: true }).boundingBox();
	if (start === null || end === null) throw new Error('no tab');
	await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
	await page.mouse.down();
	await page.mouse.move(start.x + start.width / 2 + 8, start.y + start.height / 2, { steps: 2 });
	await page.mouse.move(end.x + end.width - 4, end.y + end.height / 2, { steps: 6 });
	await page.mouse.up();
}

test('view tabs reorder by drag, by keyboard and from their menu, each undoable', async ({
	page,
	context,
	account
}) => {
	test.skip(onPhone(), 'a phone lists the views in a menu, which keeps their order');
	void account;
	await page.goto(await seedViews(context.request));
	await expect(tabs(page)).toHaveText(['Grid', 'Entry', 'Trend', 'Log']);

	await dragTab(page, 'Grid', 'Trend');
	await expect(tabs(page)).toHaveText(['Entry', 'Trend', 'Grid', 'Log']);
	await expect(page.getByRole('status')).toContainText('View "Grid" moved');
	await expect(tabs(page).getByText('Grid')).toHaveAttribute('aria-current', 'page');
	await toastButton(page, 'Undo').click();
	await expect(tabs(page)).toHaveText(['Grid', 'Entry', 'Trend', 'Log']);

	await tabs(page).getByText('Log').focus();
	await page.keyboard.press('Control+Shift+ArrowLeft');
	await page.keyboard.press('Control+Shift+ArrowLeft');
	await expect(tabs(page)).toHaveText(['Grid', 'Log', 'Entry', 'Trend']);
	await expect(tabs(page).getByText('Log')).toBeFocused();

	await tabs(page).getByText('Grid').click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Move right' }).click();
	await expect(tabs(page)).toHaveText(['Log', 'Grid', 'Entry', 'Trend']);
});

test('a view is added in two taps and its settings hold no type hints', async ({
	page,
	context,
	account
}) => {
	void account;
	await page.goto(await seedViews(context.request));

	await newView(page, 'Chart');
	await expectView(page, 'Chart');
	if (!onPhone()) await expect(tabs(page)).toHaveText(['Grid', 'Entry', 'Trend', 'Log', 'Chart']);
	await expect(page.getByRole('status')).toContainText('View "Chart" added');
	await page.keyboard.press('Escape');

	await viewSettings(page);
	const settings = page.getByRole('dialog', { name: 'View settings' });
	await expect(settings.getByRole('group', { name: 'View type' })).toHaveText('GridEntryListChart');
	await expect(settings.getByRole('button', { name: 'Chart' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
});
