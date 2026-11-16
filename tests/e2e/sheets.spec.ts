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
import {
	cell,
	columnMenu,
	expect,
	menuItem,
	pick,
	seed,
	tableMenu,
	tablePath,
	test,
	undo,
	workbook
} from './harness.ts';

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

test.describe('grid keys', () => {
	test('selects a column and a row, sums them, fills a range and stamps today', async ({
		page,
		context,
		account
	}) => {
		void account;
		const lifts = await seedLifts(context.request);
		await page.goto(lifts.path);
		await expect(cell(page, 'belt')).toBeVisible();
		const keys = page.keyboard;
		const summary = page.locator('p').filter({ hasText: 'Average' });
		const sums = async (sum: string, average: string, count: string): Promise<void> => {
			await expect(summary).toContainText(`Sum ${sum}`);
			await expect(summary).toContainText(`Average ${average}`);
			await expect(summary).toContainText(`Count ${count}`);
		};

		await page.getByRole('grid').focus();
		await keys.press('ArrowRight');
		await keys.press('Control+Space');
		await sums('340', '85', '4');

		await keys.press('Escape');
		await expect(summary).toHaveCount(0);
		for (let step = 0; step < 3; step += 1) await keys.press('ArrowDown');
		await keys.press('Shift+Space');
		await sums('320.46', '160.23', '2');

		await keys.press('Escape');
		for (let step = 0; step < 3; step += 1) await keys.press('ArrowUp');
		await keys.press('ArrowRight');
		await keys.press('Shift+ArrowDown');
		await keys.type('50');
		await keys.press('Control+Enter');
		const kgs = column(page, 1);
		await expect(kgs).toHaveText(['50', '50', '80', '100']);
		await expect(page.getByRole('status')).toContainText('Filled 2 cells');
		await undo(page);
		await expect(kgs).toHaveText(['70', '90', '80', '100']);

		await page.getByRole('grid').focus();
		await keys.press('ArrowRight');
		await keys.press('ArrowRight');
		await keys.press('Control+;');
		await keys.press('Enter');
		const today = new Intl.DateTimeFormat('en-US', {
			month: 'short',
			day: 'numeric',
			timeZone: 'UTC'
		}).format(new Date());
		await expect(column(page, 3).nth(1)).toHaveText(today);
	});

	test('copies a range as a table for documents too', async ({ page, context, account }) => {
		test.skip(test.info().project.name === 'phone', 'copying a range takes a keyboard and a mouse');
		void account;
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);
		const lifts = await seedLifts(context.request);
		await page.goto(lifts.path);

		await cell(page, 'easy bar').click();
		await cell(page, 'deep').click({ modifiers: ['Shift'] });
		await page.keyboard.press('Control+C');

		await expect
			.poll(() =>
				page.evaluate(async () => {
					const [item] = await navigator.clipboard.read();
					return (await item.getType('text/html')).text();
				})
			)
			.toContain('<td>easy bar</td></tr><tr><td>deep</td>');
	});
});

function seedLong(request: APIRequestContext): Promise<string> {
	return seed(request, (ws, commit) => {
		const base = createBase(ws, 'Gym');
		commit(base.changes);
		const table = createTable(
			ws,
			base.id,
			'Sets',
			[
				{ name: 'Note', type: 'text' },
				{ name: 'Kg', type: 'number' }
			],
			() => defaultViews(names.en)
		);
		commit(table.changes);
		const [note, kg] = table.fieldIds;
		commit(
			insertRows(
				ws,
				table.id,
				Array.from({ length: 150 }, (_, at) => ({
					[note]: at === 119 || at === 144 ? `heavy bar ${at + 1}` : `set ${at + 1}`,
					[kg]: at
				}))
			).changes
		);
		return tablePath(table.id);
	});
}

test.describe('find and replace', () => {
	test('finds through every row and replaces in one undo step', async ({
		page,
		context,
		account
	}) => {
		void account;
		await page.goto(await seedLong(context.request));
		await expect(cell(page, 'set 1')).toBeVisible();
		await expect(cell(page, 'heavy bar 145')).toHaveCount(0);

		if (test.info().project.name === 'phone') {
			await columnMenu(page, 'Note', 'Find and replace');
		} else {
			await page.getByRole('grid').focus();
			await page.keyboard.press('Control+h');
		}
		const find = page.getByRole('textbox', { name: 'Find' });
		await expect(find).toBeFocused();
		const replace = page.getByRole('textbox', { name: 'Replace with' });
		for (const input of [find, replace]) {
			expect((await input.boundingBox())?.width ?? 0).toBeGreaterThan(160);
		}
		await find.fill('BAR');
		await expect(page.getByText('1 of 2')).toBeVisible();
		await expect(cell(page, 'heavy bar 120')).toBeInViewport();
		await find.press('Enter');
		await expect(page.getByText('2 of 2')).toBeVisible();
		await expect(cell(page, 'heavy bar 145')).toBeInViewport();

		await replace.fill('bell');
		await page.getByRole('button', { name: 'Replace all' }).click();
		await expect(page.getByRole('status')).toContainText('Replaced in 2 cells');
		await expect(cell(page, 'heavy bell 145')).toBeVisible();
		await expect(page.getByText('No match')).toBeVisible();

		await find.press('Escape');
		await expect(find).toHaveCount(0);
		await undo(page);
		await expect(cell(page, 'heavy bar 145')).toBeVisible();
	});

	test('opens with Ctrl+F after a menu has closed, not the browser find', async ({
		page,
		context,
		account
	}) => {
		test.skip(test.info().project.name === 'phone', 'a phone has no Ctrl+F');
		void account;
		await page.goto(await seedLong(context.request));
		await columnMenu(page, 'Kg', 'Sort descending');
		await expect(page.getByRole('menu')).toHaveCount(0);
		await page.keyboard.press('Control+f');
		await expect(page.getByRole('textbox', { name: 'Find' })).toBeFocused();
		await expect(page.getByRole('textbox', { name: 'Replace with' })).toHaveCount(0);
	});
});

test.describe('duplicate and unhide', () => {
	test('duplicates a row, a field, a view and a table, and shows a hidden field again', async ({
		page,
		context,
		account
	}) => {
		void account;
		const lifts = await seedLifts(context.request);
		await page.goto(lifts.path);
		const onPhone = test.info().project.name === 'phone';

		await cell(page, 'deep').click({ button: 'right' });
		await menuItem(page, 'Duplicate row').click();
		await expect(cell(page, 'deep')).toHaveCount(2);
		await expect(column(page, 2)).toHaveText(['easy bar', 'deep', 'deep', 'bar path', 'belt']);

		await columnMenu(page, 'Kg', 'Duplicate');
		await expect(page.getByRole('columnheader', { name: 'Kg copy' })).toBeVisible();
		await undo(page);
		await expect(page.getByRole('columnheader', { name: 'Kg copy' })).toHaveCount(0);

		await columnMenu(page, 'Kg', 'Hide');
		await expect(page.getByRole('columnheader', { name: 'Kg', exact: true })).toHaveCount(0);
		if (onPhone) {
			await columnMenu(page, 'Note', 'Show Kg');
		} else {
			await page.getByRole('columnheader', { name: 'Note' }).getByRole('button').click();
			await page.getByRole('menuitem', { name: '1 hidden field' }).click();
			await page.getByRole('menuitem', { name: 'Kg', exact: true }).click();
		}
		await expect(page.getByRole('columnheader', { name: 'Kg', exact: true })).toBeVisible();

		if (!onPhone) {
			await page.getByRole('link', { name: 'Grid', exact: true }).click({ button: 'right' });
			await page.getByRole('menuitem', { name: 'Duplicate view' }).click();
			await expect(page.getByRole('link', { name: 'Grid copy' })).toHaveAttribute(
				'aria-current',
				'page'
			);
		}

		await tableMenu(page, 'Duplicate table');
		await expect(page).toHaveTitle(/Lifts copy/u);
		await expect(cell(page, 'belt')).toBeVisible();
	});
});

test.describe('formula guard', () => {
	test('refuses a column total as a row formula', async ({ page, context, account }) => {
		void account;
		const lifts = await seedLifts(context.request);
		await page.goto(lifts.path);
		await columnMenu(page, 'ƒ Pounds', 'Field settings');
		const sheet = page.getByRole('dialog', { name: 'Field', exact: true });
		const formula = sheet.getByRole('textbox', { name: 'Formula' });
		await formula.fill('SUM("Kg")');
		await formula.press('Control+Enter');
		await expect(sheet.getByRole('alert')).toHaveText("a column total isn't a row formula");
		await formula.fill('SUM("Kg") OVER ()');
		await formula.press('Control+Enter');
		await expect(sheet).toHaveCount(0);
		await expect(cell(page, '340')).toHaveCount(4);
	});
});

test.describe('excel import', () => {
	test('imports an .xlsx by hand into a new table', async ({ page, account }) => {
		void account;
		await page.goto('/app');
		await page.getByRole('button', { name: 'Import', exact: true }).click();
		await page.getByLabel('File to import').setInputFiles({
			name: 'weigh-ins.xlsx',
			mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			buffer: workbook(
				'<row r="1"><c r="A1" t="inlineStr"><is><t>Day</t></is></c><c r="B1" t="inlineStr"><is><t>Kg</t></is></c></row>' +
					'<row r="2"><c r="A2" t="inlineStr"><is><t>2026-10-30</t></is></c><c r="B2"><v>81.5</v></c></row>'
			)
		});
		await page.getByRole('dialog').getByRole('button', { name: 'Import', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'weigh-ins' })).toBeVisible();
		await expect(cell(page, '81.5')).toBeVisible();
	});
});

const FORMATS = [
	{
		locale: 'en-US',
		fields: fields.en,
		grid: grid.en,
		closeWord: common.en.close,
		day: 'November 2, 2026',
		pounds: '154.3'
	},
	{
		locale: 'fr-FR',
		fields: fields.fr,
		grid: grid.fr,
		closeWord: common.fr.close,
		day: '2 novembre 2026',
		pounds: '154,3'
	}
];

for (const { locale, fields: words, grid: gridWords, closeWord, day, pounds } of FORMATS) {
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
			const close = sheet.getByRole('button', { name: closeWord, exact: true });
			const long = new Intl.DateTimeFormat(locale, {
				day: 'numeric',
				month: 'long',
				year: 'numeric',
				timeZone: 'UTC'
			}).format(new Date());

			await columnMenu(page, 'Day', gridWords.fieldSettings);
			await pick(sheet.getByRole('combobox', { name: words.format }), long);
			await close.click();
			await expect(cell(page, day)).toBeVisible();

			await columnMenu(page, 'ƒ Pounds', gridWords.fieldSettings);
			await pick(sheet.getByRole('combobox', { name: words.shownAs }), words.types.number);
			await pick(sheet.getByRole('combobox', { name: words.decimals }), '1');
			await close.click();
			await expect(cell(page, pounds)).toBeVisible();

			if (test.info().project.name === 'desktop') {
				await cell(page, day).dblclick();
				await expect(page.getByRole('gridcell').getByRole('textbox')).toHaveValue(day);
			}
		});
	});
}
