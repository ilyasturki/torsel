import names from '../../src/lib/i18n/names.ts';
import type { APIRequestContext, Locator, Page } from '@playwright/test';

import common from '../../src/lib/i18n/common.ts';
import fields from '../../src/lib/i18n/fields.ts';
import grid from '../../src/lib/i18n/grid.ts';
import {
	addField,
	createBase,
	createTable,
	defaultViews,
	insertRows
} from '../../src/lib/core/actions.ts';
import type { Rec } from '../../src/lib/core/model.ts';
import { cell, columnMenu, expect, pick, seed, tablePath, test, undo } from './harness.ts';

type Lifts = { path: string; table: string; fields: string[] };

function seedLifts(request: APIRequestContext): Promise<Lifts> {
	return seed(request, (ws, commit) => {
		const base = createBase(ws, 'Gym');
		commit(base.changes);
		const table = createTable(
			ws,
			base.id,
			'Lifts',
			[
				{
					name: 'Exercise',
					type: 'choice',
					choices: [
						{ name: 'Squat', color: null },
						{ name: 'Bench', color: null }
					]
				},
				{ name: 'Kg', type: 'number' },
				{ name: 'Note', type: 'text' },
				{ name: 'Day', type: 'date' }
			],
			() => defaultViews(names.en)
		);
		commit(table.changes);
		const [exercise, kg, note, day] = table.fieldIds;
		commit(
			addField(ws, table.id, { name: 'Pounds', type: 'formula', expr: `{{${kg}}} * 2.2046` })
				.changes
		);
		commit(
			insertRows(ws, table.id, [
				{ [exercise]: 'Bench', [kg]: 70, [note]: 'easy bar', [day]: '2026-11-02' },
				{ [exercise]: 'Squat', [kg]: 90, [note]: 'deep', [day]: '2026-11-03' },
				{ [exercise]: 'Bench', [kg]: 80, [note]: 'bar path', [day]: '2026-11-04' },
				{ [exercise]: 'Squat', [kg]: 100, [note]: 'belt', [day]: '2026-11-05' }
			]).changes
		);
		return { path: tablePath(table.id), table: table.id, fields: table.fieldIds };
	});
}

export async function storedRows(page: Page, table: string): Promise<Rec[]> {
	const pull = await page.context().request.post('/api/sync', { data: { watermark: 0, push: [] } });
	const { records } = (await pull.json()) as { records: Rec[] };
	return records.filter((rec) => rec.kind === 'row' && rec.parent === table && !rec.data._del);
}

const column = (page: Page, index: number): Locator =>
	page
		.locator('tbody tr')
		.filter({ has: page.getByRole('button', { name: 'Open row' }) })
		.locator(`td[aria-colindex="${index + 2}"]`);

test.describe('sheets essentials', () => {
	test('sorts on a second column from the column menu', async ({ page, context, account }) => {
		void account;
		const lifts = await seedLifts(context.request);
		await page.goto(lifts.path);
		await expect(cell(page, 'belt')).toBeVisible();

		await columnMenu(page, 'Exercise', 'Sort ascending');
		await columnMenu(page, 'Kg', 'Add to sort');
		const kgs = column(page, 1);
		await expect(kgs).toHaveText(['70', '80', '90', '100']);
		await expect(page.getByRole('columnheader', { name: 'Kg' })).toContainText('2');

		await columnMenu(page, 'Kg', 'Sort descending');
		await expect(kgs).toHaveText(['80', '70', '100', '90']);

		await columnMenu(page, 'Exercise', 'Clear sort');
		await expect(kgs).toHaveText(['100', '90', '80', '70']);
		await undo(page);
		await expect(kgs).toHaveText(['80', '70', '100', '90']);
	});
});

const FORMATS = [
	{
		locale: 'en-US',
		fields: fields.en,
		grid: grid.en,
		saveWord: common.en.save,
		day: 'November 2, 2026',
		pounds: '154.3'
	},
	{
		locale: 'fr-FR',
		fields: fields.fr,
		grid: grid.fr,
		saveWord: common.fr.save,
		day: '2 novembre 2026',
		pounds: '154,3'
	}
];

for (const { locale, fields: words, grid: gridWords, saveWord, day, pounds } of FORMATS) {
	test.describe(`formats in ${locale}`, () => {
		test.use({ locale });

		test('a date field takes a look and a formula a result format', async ({
			page,
			context,
			account
		}) => {
			void account;
			const lifts = await seedLifts(context.request);
			await page.goto(lifts.path);

			const sheet = page.getByRole('dialog', { name: words.field, exact: true });
			const save = sheet.getByRole('button', { name: saveWord, exact: true });
			const long = new Intl.DateTimeFormat(locale, {
				day: 'numeric',
				month: 'long',
				year: 'numeric',
				timeZone: 'UTC'
			}).format(new Date());

			await columnMenu(page, 'Day', gridWords.fieldSettings);
			await pick(sheet.getByRole('combobox', { name: words.format }), long);
			await save.click();
			await expect(cell(page, day)).toBeVisible();

			await columnMenu(page, 'Pounds', gridWords.fieldSettings);
			await pick(sheet.getByRole('combobox', { name: words.shownAs }), words.types.number);
			await pick(sheet.getByRole('combobox', { name: words.decimals }), '1');
			await save.click();
			await expect(cell(page, pounds)).toBeVisible();

			if (test.info().project.name === 'desktop') {
				await cell(page, day).dblclick();
				await expect(page.getByRole('gridcell').getByRole('textbox')).toHaveValue(day);
			}
		});
	});
}
