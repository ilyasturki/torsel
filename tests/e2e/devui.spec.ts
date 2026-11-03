import type { Page } from '@playwright/test';

import { expect, pick, test } from './harness.ts';

async function open(page: Page): Promise<void> {
	await page.goto('/dev/ui');
	await expect(page.getByRole('heading', { name: 'Design system' })).toBeVisible();
	await expect(
		page.locator('#grid').getByRole('gridcell', { name: 'Bench press' }).first()
	).toBeVisible();
}

test('the design system shows every section, stays out of search, and fits the screen', async ({
	page
}) => {
	await open(page);

	await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/u);
	for (const id of [
		'colors',
		'button',
		'select',
		'menu',
		'dialog',
		'textarea',
		'grid',
		'entry',
		'list',
		'chart',
		'changecard',
		'spark',
		'tally'
	]) {
		await expect(page.locator(`section#${id}`)).toBeAttached();
	}
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

	await page.goto('/dev/ui#select');
	await expect(page.getByRole('heading', { name: 'Select' })).toBeInViewport();
});

test('the theme switch shows the other scheme whatever the system says', async ({ page }) => {
	await page.emulateMedia({ colorScheme: 'light' });
	await open(page);
	const canvas = (): Promise<string> =>
		page.evaluate(() => getComputedStyle(document.body).backgroundColor);
	const light = await canvas();

	await page.getByRole('group', { name: 'Theme' }).getByRole('button', { name: 'Dark' }).click();
	await expect.poll(canvas).not.toBe(light);

	await page.getByRole('group', { name: 'Theme' }).getByRole('button', { name: 'Light' }).click();
	await expect.poll(canvas).toBe(light);
});

test('a select is driven by the keyboard, and a long one searches as you type', async ({
	page
}) => {
	await open(page);

	const order = page.locator('#select').getByRole('combobox', { name: 'Order' });
	await order.focus();
	await page.keyboard.press('ArrowDown');
	await expect(page.getByRole('option', { name: 'Descending' })).toBeVisible();
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('Enter');
	await expect(order).toHaveValue('Descending');
	await expect(page.getByRole('listbox')).toHaveCount(0);
	await expect(order).toBeFocused();

	const field = page.locator('#select').getByRole('combobox', { name: 'Field' });
	await field.focus();
	await page.keyboard.type('res');
	await expect(page.getByRole('option')).toHaveText(['Rest']);
	await page.keyboard.press('Enter');
	await expect(field).toHaveValue('Rest');

	await pick(page.locator('#select').getByRole('combobox', { name: 'Session' }), 'Pull');
	await expect(page.locator('#select').getByRole('combobox', { name: 'Session' })).toHaveValue(
		'Pull'
	);
});

test('a textarea grows with its lines, then scrolls past its cap', async ({ page }) => {
	await open(page);
	const notes = page.locator('#textarea').getByRole('textbox', { name: 'Notes' });
	const height = async (): Promise<number> => (await notes.boundingBox())?.height ?? 0;

	await notes.fill('One line');
	const one = await height();
	await notes.fill('1\n2\n3\n4');
	const four = await height();
	expect(four).toBeGreaterThan(one * 2);

	await notes.fill(Array.from({ length: 20 }, (_, index) => `Set ${index + 1}`).join('\n'));
	const capped = await height();
	expect(capped).toBeGreaterThan(four);
	expect(await notes.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);

	const composer = page.locator('#textarea').getByRole('textbox', { name: 'Composer' });
	await composer.fill('Add a set');
	await composer.press('Shift+Enter');
	await composer.pressSequentially('then another');
	await expect(composer).toHaveValue('Add a set\nthen another');
});

test('a menu opens from its button with a submenu, and from a right-click', async ({ page }) => {
	await open(page);
	const choice = page.getByTestId('menu-choice');

	await page.locator('#menu').getByRole('button', { name: 'More' }).click();
	await expect(page.getByRole('menuitem', { name: 'Export (disabled)' })).toHaveAttribute(
		'aria-disabled',
		'true'
	);
	await page.getByRole('menuitem', { name: 'Move to' }).focus();
	await page.keyboard.press('ArrowRight');
	await page.getByRole('menuitem', { name: 'Gym' }).click();
	await expect(choice).toHaveText('Moved to Gym');
	await expect(page.getByRole('menu')).toHaveCount(0);

	await page.getByText('Right-click here').click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Insert below' }).click();
	await expect(choice).toHaveText('Insert below');
});

test('a dialog is centred from sm up and a sheet on a phone', async ({ page }) => {
	await open(page);
	await page.getByRole('button', { name: 'Open a dialog' }).click();
	const dialog = page.getByRole('dialog', { name: 'Rename base' });
	await expect(dialog.getByRole('textbox', { name: 'Base name' })).toBeFocused();

	const box = await dialog.boundingBox();
	const viewport = page.viewportSize();
	if (box === null || viewport === null) throw new Error('no dialog box');
	const bottomGap = viewport.height - box.y - box.height;
	if (test.info().project.name === 'phone') {
		expect(Math.round(bottomGap)).toBe(0);
		expect(Math.round(box.width)).toBe(viewport.width);
	} else {
		expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThan(2);
		expect(bottomGap).toBeGreaterThan(100);
	}

	await page.keyboard.press('Escape');
	await expect(dialog).toHaveCount(0);
});
