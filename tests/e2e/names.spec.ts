import type { APIRequestContext } from '@playwright/test';

import { createBase, createTable } from '../../src/lib/core/actions.ts';
import { columnMenu, expect, seed, tableMenu, tablePath, test } from './harness.ts';

function seedGym(request: APIRequestContext): Promise<string> {
	return seed(request, (ws, commit) => {
		const base = createBase(ws, 'Gym');
		commit(base.changes);
		const lifts = createTable(ws, base.id, 'Lifts', [
			{ name: 'Exercise', type: 'text' },
			{ name: 'Kg', type: 'number' }
		]);
		commit(lifts.changes);
		commit(createTable(ws, base.id, 'Runs', [{ name: 'Km', type: 'number' }]).changes);
		return tablePath(lifts.id);
	});
}

test('a field takes no name another field of its table has', async ({ page, context, account }) => {
	void account;
	await page.goto(await seedGym(context.request));

	await page.locator('button[aria-label="Add a field"]').click();
	const adding = page.getByRole('dialog', { name: 'Add a field' });
	const name = adding.getByRole('textbox', { name: 'Field name' });
	await name.fill(' kg');
	await expect(adding.getByRole('alert')).toHaveText('A field named "Kg" already exists.');
	await expect(adding.getByRole('button', { name: 'Add', exact: true })).toBeDisabled();
	await name.press('Enter');
	await expect(page.getByRole('columnheader', { name: /^kg$/iu })).toHaveCount(1);

	await name.fill('Reps');
	await expect(adding.getByRole('alert')).toHaveCount(0);
	await name.press('Enter');
	await expect(page.getByRole('columnheader', { name: 'Reps', exact: true })).toBeVisible();
	await page.keyboard.press('Escape');

	await columnMenu(page, 'Reps', 'Rename');
	const rename = page.getByRole('textbox', { name: 'Name of Reps' });
	await rename.fill('exercise');
	await rename.press('Enter');
	await expect(page.getByRole('status')).toContainText('A field named "Exercise" already exists.');
	await expect(page.getByRole('columnheader', { name: 'Reps', exact: true })).toBeVisible();
});

test('a table takes no name another table of its base has', async ({ page, context, account }) => {
	void account;
	await page.goto(await seedGym(context.request));

	await tableMenu(page, 'Rename table');
	const name = page.getByRole('textbox', { name: 'Table name' });
	await name.fill('runs');
	await name.press('Enter');

	await expect(page.getByRole('status')).toContainText('A table named "Runs" already exists.');
	await expect(page.getByRole('heading', { name: 'Lifts' })).toBeVisible();
});
