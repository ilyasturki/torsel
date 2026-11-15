import names from '../../src/lib/i18n/names.ts';
import type { APIRequestContext } from '@playwright/test';

import { createBase, createTable, defaultViews, insertRows } from '../../src/lib/core/actions.ts';
import { cell, expect, pick, seed, tablePath, test, toastButton } from './harness.ts';

function seedFilms(request: APIRequestContext) {
	return seed(request, (ws, commit) => {
		const base = createBase(ws, 'Films');
		commit(base.changes);
		const films = createTable(
			ws,
			base.id,
			'Films',
			[
				{ name: 'Title', type: 'text' },
				{
					name: 'Status',
					type: 'choice',
					choices: [
						{ name: 'watched', color: 'amber' },
						{ name: 'to watch', color: 'orange' }
					]
				},
				{ name: 'Rating', type: 'number' }
			],
			() => defaultViews(names.en)
		);
		commit(films.changes);
		const [title, status, rating] = films.fieldIds;
		commit(
			insertRows(ws, films.id, [
				{ [title]: 'Dune', [status]: 'watched', [rating]: 8 },
				{ [title]: 'Alien', [status]: 'to watch', [rating]: null }
			]).changes
		);
		return tablePath(films.id);
	});
}

test('a row sheet edits in place, each change undoable, and walks the rows', async ({
	page,
	context,
	account
}) => {
	void account;
	await page.goto(await seedFilms(context.request));
	await page.getByRole('button', { name: 'Open row' }).first().click();
	const sheet = page.getByRole('dialog', { name: 'Dune' });
	await expect(sheet).toBeVisible();
	await expect(sheet.getByLabel('Rating')).not.toBeFocused();
	await expect(sheet.getByRole('button', { name: 'Save' })).toHaveCount(0);

	await sheet.getByLabel('Rating').fill('9');
	await sheet.getByLabel('Title').click();
	await expect(page.getByRole('status')).toContainText('Row changed');
	await expect(cell(page, '9')).toBeVisible();
	await expect(sheet).toBeVisible();

	await pick(sheet.getByLabel('Status'), 'to watch');
	await expect(cell(page, 'to watch')).toHaveCount(2);
	await toastButton(page, 'Undo').click();
	await expect(cell(page, 'watched')).toBeVisible();

	await sheet.getByRole('button', { name: 'Next row' }).click();
	const next = page.getByRole('dialog', { name: 'Alien' });
	await expect(next.getByLabel('Title')).toHaveValue('Alien');
	await expect(next.getByRole('button', { name: 'Next row' })).toBeDisabled();
	await next.getByLabel('Rating').fill('7');
	await page.keyboard.press('Escape');
	await expect(next).toHaveCount(0);
	await expect(cell(page, '7')).toBeVisible();

	await page.getByRole('button', { name: 'Open row' }).last().click();
	await page.getByRole('dialog').getByRole('button', { name: 'More' }).click();
	await page.getByRole('menuitem', { name: 'Delete row' }).click();
	await expect(cell(page, 'Alien')).toHaveCount(0);
});
