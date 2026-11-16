import names from '../../src/lib/i18n/names.ts';
import type { APIRequestContext } from '@playwright/test';

import {
	createBase,
	createTable,
	defaultViews,
	insertRows,
	updateRecord
} from '../../src/lib/core/actions.ts';
import type { Value } from '../../src/lib/core/model.ts';
import type { FakeStep } from './fake-anthropic.ts';
import { cell, columnMenu, expect, seed, tablePath, test, toastButton } from './harness.ts';

const FAKE = process.env.TORSEL_TEST_FAKE ?? '';

/** Scripts the fake under a key the seeded titles already hold, so the steps can name their rows. */
async function scriptAs(request: APIRequestContext, key: string, steps: FakeStep[]): Promise<void> {
	const response = await request.post(`${FAKE}/__script?key=${key}`, { data: { steps } });
	expect(response.ok()).toBe(true);
}

type Seen = { requests: { body: { system: string; tools: { name: string }[] } }[] };

/** Films whose titles hold the script's key; IMDb is filled from Title when `fill` is given. */
function seedFilms(request: APIRequestContext, key: string, fill?: Record<string, Value>) {
	return seed(request, (ws, commit) => {
		const base = createBase(ws, 'Cinema');
		commit(base.changes);
		const table = createTable(
			ws,
			base.id,
			'Films',
			[
				{ name: 'Title', type: 'text' },
				{ name: 'IMDb', type: 'number' }
			],
			() => defaultViews(names.en)
		);
		commit(table.changes);
		const [title, imdb] = table.fieldIds;
		const rows = insertRows(ws, table.id, [
			{ [title]: `Dune ${key}` },
			{ [title]: `Alien ${key}`, [imdb]: 8.5 },
			{ [title]: `Parasite ${key}` }
		]);
		commit(rows.changes);
		if (fill !== undefined) {
			commit(updateRecord(ws, imdb, { fill: { prompt: `IMDb rating of {{${title}}}`, ...fill } }));
		}
		return { path: tablePath(table.id), rows: rows.ids };
	});
}

test('a field set to fill with AI fills its empty cells from the column menu, in one undo', async ({
	page,
	context,
	account
}) => {
	void account;
	const key = `fill-${crypto.randomUUID()}`;
	const { path, rows } = await seedFilms(context.request, key);
	await scriptAs(context.request, key, [
		{
			blocks: [
				{
					type: 'tool',
					id: 'toolu_set',
					name: 'set_values',
					input: {
						values: [
							{ row: rows[0], value: '8.6' },
							{ row: rows[2], value: 'not a number' }
						]
					}
				}
			]
		}
	]);
	await page.goto(path);

	await columnMenu(page, 'IMDb', 'Field settings');
	const sheet = page.getByRole('dialog', { name: 'Field' });
	await sheet.getByLabel('Fill with AI').check();
	const prompt = sheet.getByLabel('Prompt');
	await prompt.fill('IMDb rating of ');
	await sheet.getByRole('button', { name: 'Title', exact: true }).click();
	await expect(prompt).toHaveValue('IMDb rating of {Title}');
	await sheet.getByRole('button', { name: 'Close' }).click();

	await columnMenu(page, 'IMDb', 'Fill empty cells');
	await expect(page.getByText('Filled 1 cell')).toBeVisible();
	await expect(cell(page, '8.6')).toBeVisible();
	await expect(cell(page, '8.5')).toBeVisible();

	await toastButton(page, 'Undo').click();
	await expect(cell(page, '8.6')).toHaveCount(0);
	await expect(cell(page, '8.5')).toBeVisible();
});

test('new rows of a field set to fill them get their value quietly once typing settles', async ({
	page,
	context,
	account
}) => {
	void account;
	const key = `fill-${crypto.randomUUID()}`;
	const { path, rows } = await seedFilms(context.request, key, {
		web: true,
		auto: true,
		since: 0
	});
	await scriptAs(context.request, key, [
		{
			blocks: [
				{
					type: 'tool',
					id: 'toolu_set',
					name: 'set_values',
					input: {
						values: [
							{ row: rows[0], value: '8.6' },
							{ row: rows[2], value: '8.5' }
						]
					}
				}
			]
		}
	]);
	await page.goto(path);
	await expect(cell(page, '8.6')).toBeVisible({ timeout: 15_000 });
	await expect(page.getByText('Filled 2 cells')).toHaveCount(0);

	const { requests } = (await (
		await context.request.get(`${FAKE}/__seen?key=${key}`)
	).json()) as Seen;
	expect(requests).toHaveLength(1);
	expect(requests[0].body.system).toMatch(/^You fill one field/u);
	expect(requests[0].body.tools.map((tool) => tool.name)).toEqual(['set_values', 'web_search']);
});

test.describe('fr-FR', () => {
	test.use({ locale: 'fr-FR' });

	test('the settings and the menu speak French', async ({ page, context, account }) => {
		void account;
		const { path } = await seedFilms(context.request, 'fr', {
			web: false,
			auto: false,
			since: 0
		});
		await page.goto(path);
		await columnMenu(page, 'IMDb', 'Réglages du champ');
		const sheet = page.getByRole('dialog');
		await expect(sheet.getByLabel('Remplir avec l’IA')).toBeChecked();
		await expect(sheet.getByLabel('Consigne')).toHaveValue('IMDb rating of {Title}');
		await sheet.getByRole('button', { name: 'Fermer' }).click();
		await page.getByRole('columnheader', { name: 'IMDb', exact: true }).getByRole('button').click();
		await expect(page.getByText('Remplir les cellules vides')).toBeVisible();
	});
});
