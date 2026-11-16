import grid from '../../src/lib/i18n/grid.ts';
import names from '../../src/lib/i18n/names.ts';
import type { APIRequestContext, Locator, Page } from '@playwright/test';

import type { FieldSpec } from '../../src/lib/core/actions.ts';
import {
	addField,
	createBase,
	createTable,
	defaultViews,
	insertRows
} from '../../src/lib/core/actions.ts';
import { toStored } from '../../src/lib/core/formula.ts';
import type { Rec, Value } from '../../src/lib/core/model.ts';
import { columnMenu, expect, openAsk, script, seed, tablePath, test } from './harness.ts';

const FIELDS: FieldSpec[] = [
	{ name: 'Title', type: 'text' },
	{ name: 'Notes', type: 'longtext' },
	{ name: 'Year', type: 'number', grouping: false },
	{ name: 'Price', type: 'currency', currency: 'EUR' },
	{ name: 'Share', type: 'percent' },
	{ name: 'Score', type: 'rating', max: 10 },
	{ name: 'Length', type: 'duration' },
	{ name: 'Released', type: 'date' },
	{ name: 'Seen', type: 'datetime' },
	{
		name: 'Genre',
		type: 'choice',
		choices: [
			{ name: 'Sci-fi', color: 'blue' },
			{ name: 'Drama', color: 'green' }
		]
	},
	{
		name: 'Tags',
		type: 'choices',
		choices: [
			{ name: 'Epic', color: 'violet' },
			{ name: 'Desert', color: 'amber' }
		]
	},
	{ name: 'Owned', type: 'check' },
	{ name: 'Site', type: 'url' },
	{ name: 'Contact', type: 'email' },
	{ name: 'Phone', type: 'phone' }
];

const VALUES: Record<string, Value> = {
	Title: 'Dune',
	Notes: 'First line\nSecond line',
	Year: 12021,
	Price: 12.5,
	Share: 40,
	Score: 8,
	Length: 9300,
	Released: '2021-10-22',
	Seen: '2024-03-01T20:30',
	Genre: 'Sci-fi',
	Tags: ['Epic', 'Desert'],
	Owned: true,
	Site: 'https://dunemovie.com',
	Contact: 'press@dune.film',
	Phone: '+1 555 010 2030'
};

type Movies = { grid: string; table: string; ids: Record<string, string>; directors: string[] };

function seedMovies(request: APIRequestContext): Promise<Movies> {
	return seed(request, (ws, commit) => {
		const base = createBase(ws, 'Films');
		commit(base.changes);
		const people = createTable(ws, base.id, 'Directors', [{ name: 'Name', type: 'text' }], () =>
			defaultViews(names.en)
		);
		commit(people.changes);
		const made = insertRows(ws, people.id, [
			{ [people.fieldIds[0]]: 'Villeneuve' },
			{ [people.fieldIds[0]]: 'Lynch' }
		]);
		commit(made.changes);
		const table = createTable(
			ws,
			base.id,
			'Movies',
			[...FIELDS, { name: 'Director', type: 'link', target: people.id }],
			() => defaultViews(names.en)
		);
		commit(table.changes);
		const ids = Object.fromEntries(
			[...FIELDS.map((field) => field.name), 'Director'].map((name, at) => [
				name,
				table.fieldIds[at]
			])
		);
		const total = addField(ws, table.id, {
			name: 'Total',
			type: 'formula',
			expr: toStored('"Price" * 2', ws.fields(table.id))
		});
		commit(total.changes);
		ids.Total = total.id;
		commit(
			insertRows(ws, table.id, [
				{
					...Object.fromEntries(Object.entries(VALUES).map(([name, value]) => [ids[name], value])),
					[ids.Director]: made.ids[0]
				}
			]).changes
		);
		return {
			grid: tablePath(table.id, table.viewIds[0]),
			table: table.id,
			ids,
			directors: made.ids
		};
	});
}

async function stored(page: Page, movies: Movies): Promise<Record<string, Value>> {
	const pull = await page.context().request.post('/api/sync', { data: { watermark: 0, push: [] } });
	const { records } = (await pull.json()) as { records: Rec[] };
	const row = records.find((rec) => rec.kind === 'row' && rec.parent === movies.table);
	return Object.fromEntries(
		Object.entries(movies.ids).map(([name, id]) => [name, row?.data[id] ?? null])
	);
}

const onPhone = (): boolean => test.info().project.name === 'phone';

/** A field's stored data once the client has synced it, found by name. */
async function fieldData(page: Page, name: string): Promise<Record<string, Value> | undefined> {
	const pull = await page.context().request.post('/api/sync', { data: { watermark: 0, push: [] } });
	const { records } = (await pull.json()) as { records: Rec[] };
	return records.find((rec) => rec.kind === 'field' && rec.data.name === name)?.data;
}

// A phone edits these in a drawer, not in the cell.
const DRAWN = new Set(['Length', 'Released', 'Seen']);

/** The first row's cell under a field, by the field's place in the table. */
function cellOf(page: Page, name: string): Locator {
	const at = [...FIELDS.map((field) => field.name), 'Director', 'Total'].indexOf(name);
	return page.locator(`td[data-r="0"][data-c="${at}"]`);
}

/** Writes over a cell: typed into the selected cell on a desktop, into the editor a tap opens on a phone. */
async function typeInto(page: Page, name: string, text: string): Promise<void> {
	const target = cellOf(page, name);
	await target.scrollIntoViewIfNeeded();
	if (onPhone() && DRAWN.has(name)) {
		await target.tap();
		const drawer = page.getByRole('dialog', { name });
		await drawer.getByRole('textbox').fill(text);
		await drawer.getByRole('textbox').press('Enter');
		await expect(drawer).toHaveCount(0);
		return;
	}
	if (onPhone()) {
		await target.tap();
		await target.locator('input, textarea').fill(text);
	} else {
		await target.click();
		await page.keyboard.type(text);
	}
	await page.keyboard.press('Enter');
}

test.describe('every type in the grid', () => {
	test('shows each value its own way', async ({ page, context, account }) => {
		void account;
		const movies = await seedMovies(context.request);
		await page.goto(movies.grid);

		const shown: [string, string][] = [
			['Title', 'Dune'],
			['Notes', 'First line Second line'],
			['Year', '12021'],
			['Price', '€12.50'],
			['Share', '40%'],
			['Length', '2:35'],
			['Released', 'Oct 22, 2021'],
			['Seen', 'Mar 1, 2024 8:30 PM'],
			['Genre', 'Sci-fi'],
			['Tags', 'EpicDesert'],
			['Site', 'dunemovie.com'],
			['Contact', 'press@dune.film'],
			['Phone', '+1 555 010 2030'],
			['Director', 'Villeneuve'],
			['Total', '25']
		];
		for (const [name, text] of shown) {
			await expect(cellOf(page, name), name).toHaveText(text);
		}
		await expect(cellOf(page, 'Score').getByRole('img')).toHaveAccessibleName('8 out of 10');
		await expect(cellOf(page, 'Owned').getByRole('img')).toHaveAccessibleName('Yes');
		await expect(cellOf(page, 'Price').locator('div').first()).toHaveClass(/justify-end/u);

		const site = cellOf(page, 'Site').getByRole('link');
		await expect(site).toHaveAttribute('href', 'https://dunemovie.com');
		await expect(site).toHaveAttribute('target', '_blank');
		await expect(cellOf(page, 'Contact').getByRole('link')).toHaveAttribute(
			'href',
			'mailto:press@dune.film'
		);
		await expect(cellOf(page, 'Phone').getByRole('link')).toHaveAttribute(
			'href',
			'tel:+15550102030'
		);
	});

	test('reads what is typed into each type', async ({ page, context, account }) => {
		void account;
		const movies = await seedMovies(context.request);
		await page.goto(movies.grid);

		const cases: [string, string, string, Value][] = [
			['Title', 'Arrival', 'Arrival', 'Arrival'],
			['Year', '2016', '2016', 2016],
			['Price', '9.99', '€9.99', 9.99],
			['Share', '12.5', '12.5%', 12.5],
			['Length', '1:56', '1:56', 6960],
			['Site', 'arrival.film', 'arrival.film', 'arrival.film'],
			['Contact', 'hello@arrival.film', 'hello@arrival.film', 'hello@arrival.film'],
			['Phone', '+44 20 7946 0000', '+44 20 7946 0000', '+44 20 7946 0000']
		];
		for (const [name, typed, shown] of cases) {
			await typeInto(page, name, typed);
			await expect(cellOf(page, name), name).toHaveText(shown);
		}
		if (onPhone()) {
			await typeInto(page, 'Released', '2016-11-11');
			await typeInto(page, 'Seen', '2024-03-02T07:45');
		} else {
			await typeInto(page, 'Released', '11/11/2016');
			await typeInto(page, 'Seen', '3/2/2024 7:45 AM');
			await typeInto(page, 'Score', '7');
			await expect(cellOf(page, 'Score').getByRole('img')).toHaveAccessibleName('7 out of 10');
		}
		await expect(cellOf(page, 'Released')).toHaveText('Nov 11, 2016');
		await expect(cellOf(page, 'Seen')).toHaveText('Mar 2, 2024 7:45 AM');

		await expect
			.poll(() => stored(page, movies))
			.toMatchObject({
				...Object.fromEntries(cases.map(([name, , , value]) => [name, value])),
				Released: '2016-11-11',
				Seen: '2024-03-02T07:45',
				...(onPhone() ? {} : { Score: 7 })
			});
	});

	test('refuses what a type cannot hold, and says what it wanted', async ({
		page,
		context,
		account
	}) => {
		void account;
		const movies = await seedMovies(context.request);
		await page.goto(movies.grid);

		const refused: [string, string, string][] = [
			['Price', 'lots', `"lots" isn't an amount.`],
			['Contact', 'nobody', `"nobody" isn't an email.`]
		];
		if (!onPhone()) {
			refused.push(['Length', 'soon', `"soon" isn't a duration.`]);
			refused.push(['Score', '12', `"12" isn't a rating from 1 to 10.`]);
		}
		for (const [name, typed, toast] of refused) {
			await typeInto(page, name, typed);
			await expect(page.getByRole('status')).toContainText(toast);
			await page.keyboard.press('Escape');
		}
		await expect
			.poll(() => stored(page, movies))
			.toMatchObject({
				Price: 12.5,
				Contact: 'press@dune.film',
				Length: 9300,
				Score: 8
			});
	});

	test('sets a rating from its stars and picks several choices', async ({
		page,
		context,
		account
	}) => {
		void account;
		const movies = await seedMovies(context.request);
		await page.goto(movies.grid);

		const stars = cellOf(page, 'Score').locator('[data-stars]');
		await stars.scrollIntoViewIfNeeded();
		const box = await stars.boundingBox();
		if (box === null) throw new Error('no stars');
		const third = { x: (box.width / 10) * 2.5, y: box.height / 2 };
		await (onPhone() ? stars.tap({ position: third }) : stars.click({ position: third }));
		await expect(stars).toHaveAccessibleName('3 out of 10');

		const tags = cellOf(page, 'Tags');
		await tags.scrollIntoViewIfNeeded();
		await (onPhone() ? tags.tap() : tags.click());
		const picker = page.getByRole('listbox', { name: 'Tags' });
		await picker.getByRole('option', { name: 'Desert' }).click();
		await page.getByRole('combobox', { name: 'Tags' }).fill('Spice');
		await page.getByRole('combobox', { name: 'Tags' }).press('Enter');
		await expect(picker.getByRole('option', { name: 'Spice' })).toHaveAttribute(
			'aria-selected',
			'true'
		);
		await page.getByRole('combobox', { name: 'Tags' }).press('Escape');
		await expect(tags).toHaveText('EpicSpice');

		await expect
			.poll(() => stored(page, movies))
			.toMatchObject({
				Score: 3,
				Tags: ['Epic', 'Spice']
			});
	});

	test('writes long text over several lines', async ({ page, context, account }) => {
		test.skip(onPhone(), 'Shift+Enter is a hardware keyboard');
		void account;
		const movies = await seedMovies(context.request);
		await page.goto(movies.grid);

		await cellOf(page, 'Notes').click();
		await page.keyboard.press('Enter');
		const editor = cellOf(page, 'Notes').locator('textarea');
		await expect(editor).toHaveValue('First line\nSecond line');
		await page.keyboard.press('Shift+Enter');
		await page.keyboard.type('Third');
		await page.keyboard.press('Enter');
		await expect(editor).toHaveCount(0);

		await expect
			.poll(() => stored(page, movies))
			.toMatchObject({ Notes: 'First line\nSecond line\nThird' });
	});
});

test.describe('every type in the row sheet', () => {
	test('opens each input on its value and stores what was changed', async ({
		page,
		context,
		account
	}) => {
		void account;
		const movies = await seedMovies(context.request);
		await page.goto(movies.grid);

		await page.getByRole('button', { name: 'Open row' }).first().click();
		const sheet = page.getByRole('dialog');
		await expect(sheet.getByLabel('Title')).toHaveValue('Dune');
		await expect(sheet.getByLabel('Notes')).toHaveValue('First line\nSecond line');
		await expect(sheet.getByLabel('Year')).toHaveValue('12021');
		await expect(sheet.getByLabel('Price')).toHaveValue('12.50');
		await expect(sheet.getByText('€', { exact: true })).toBeVisible();
		await expect(sheet.getByLabel('Share')).toHaveValue('40');
		await expect(sheet.getByRole('slider', { name: 'Score' })).toHaveAttribute(
			'aria-valuenow',
			'8'
		);
		const length = sheet.getByLabel('Length', { exact: true });
		const released = sheet.getByLabel('Released', { exact: true });
		const seen = sheet.getByLabel('Seen', { exact: true });
		await expect(length).toHaveValue('2:35');
		if (onPhone()) {
			await expect(released).toHaveText('Oct 22, 2021');
			await expect(seen).toHaveText('Mar 1, 2024 8:30 PM');
		} else {
			await expect(released).toHaveValue('Oct 22, 2021');
			await expect(seen).toHaveValue('Mar 1, 2024 8:30 PM');
		}
		const tags = sheet.getByRole('group', { name: 'Tags' });
		await expect(tags.getByRole('button', { name: 'Epic' })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		await expect(sheet.getByLabel('Owned')).toBeChecked();
		await expect(sheet.getByRole('link', { name: 'Open link' })).toHaveAttribute(
			'href',
			'https://dunemovie.com'
		);
		await expect(sheet.getByRole('link', { name: 'Write an email' })).toHaveAttribute(
			'href',
			'mailto:press@dune.film'
		);
		await expect(sheet.getByRole('link', { name: 'Call' })).toHaveAttribute(
			'href',
			'tel:+15550102030'
		);

		await sheet.getByLabel('Notes').fill('Rewritten\non two lines');
		await sheet.getByLabel('Year').fill('2021');
		await sheet.getByLabel('Price').fill('15');
		await sheet.getByLabel('Share').fill('55.5');
		await sheet.getByRole('slider', { name: 'Score' }).focus();
		await page.keyboard.press('ArrowRight');
		await expect(sheet.getByRole('slider', { name: 'Score' })).toHaveAttribute(
			'aria-valuenow',
			'9'
		);
		await length.fill('2:40');
		if (onPhone()) {
			await seen.click();
			const drawer = page.getByRole('dialog', { name: 'Seen' });
			await drawer.getByRole('textbox').fill('2024-03-02 07:45');
			await drawer.getByRole('textbox').press('Enter');
			await expect(drawer).toHaveCount(0);
		} else {
			await seen.fill('2024-03-02 07:45');
		}
		await tags.getByRole('button', { name: 'Desert' }).click();
		await tags.getByRole('button', { name: 'New' }).click();
		await tags.getByLabel('New choice').fill('Spice');
		await tags.getByLabel('New choice').press('Enter');
		await expect(tags.getByRole('button', { name: 'Spice' })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		await sheet.getByLabel('Site').fill('dune.film');
		await expect(sheet.getByRole('link', { name: 'Open link' })).toHaveAttribute(
			'href',
			'https://dune.film'
		);
		await sheet.getByLabel('Contact').fill('not an email');
		await expect(sheet.getByRole('link', { name: 'Write an email' })).toHaveCount(0);
		await sheet.getByLabel('Contact').fill('team@dune.film');
		await sheet.getByLabel('Contact').press('Enter');
		await expect(sheet).toHaveCount(0);

		await expect
			.poll(() => stored(page, movies))
			.toMatchObject({
				Notes: 'Rewritten\non two lines',
				Year: 2021,
				Price: 15,
				Share: 55.5,
				Score: 9,
				Length: 9600,
				Seen: '2024-03-02T07:45',
				Tags: ['Epic', 'Spice'],
				Site: 'dune.film',
				Contact: 'team@dune.film'
			});
	});
});

test.describe('every type in fr-FR', () => {
	test.use({ locale: 'fr-FR' });

	test('shows and reads amounts, percents, durations and times the French way', async ({
		page,
		context,
		account
	}) => {
		void account;
		const movies = await seedMovies(context.request);
		await page.goto(movies.grid);

		await expect(cellOf(page, 'Price')).toHaveText('12,50 €');
		await expect(cellOf(page, 'Share')).toHaveText('40 %');
		await expect(cellOf(page, 'Length')).toHaveText('2:35');
		await expect(cellOf(page, 'Seen')).toHaveText('1 mars 2024 20:30');

		await typeInto(page, 'Price', '9,99');
		await expect(cellOf(page, 'Price')).toHaveText('9,99 €');
		await typeInto(page, 'Share', '12,5');
		await expect(cellOf(page, 'Share')).toHaveText('12,5 %');

		await page.getByRole('button', { name: grid.fr.openRow }).first().click();
		const sheet = page.getByRole('dialog');
		await expect(sheet.getByLabel('Price')).toHaveValue('9,99');
		await sheet.getByLabel('Price').fill('1 234,5');
		await sheet.getByLabel('Price').press('Enter');

		await expect.poll(() => stored(page, movies)).toMatchObject({ Price: 1234.5, Share: 12.5 });
	});
});

test.describe('the assistant', () => {
	test('types the fields it makes, a year without grouping and a score as a rating', async ({
		page,
		context,
		account
	}) => {
		void account;
		const key = await script(context.request, [
			{
				blocks: [
					{
						type: 'tool',
						id: 'toolu_table',
						name: 'create_table',
						input: {
							name: 'Films',
							fields: [
								{ name: 'Title', type: 'text' },
								{ name: 'Year', type: 'number', grouping: false },
								{ name: 'Score', type: 'rating', max: 10 }
							]
						}
					}
				]
			},
			{
				blocks: [
					{
						type: 'tool',
						id: 'toolu_rows',
						name: 'add_rows',
						input: {
							base: 'Tables',
							table: 'Films',
							rows: [{ Title: 'Paris, Texas', Year: 10984, Score: 9 }]
						}
					}
				]
			},
			{ blocks: [{ type: 'tool', id: 'toolu_open', name: 'open', input: { table: 'Films' } }] },
			{ blocks: [{ type: 'text', text: 'Ready.' }] }
		]);
		await page.goto('/app');
		await openAsk(page);
		await page.getByPlaceholder('Ask about your tables').fill(`${key} my films`);
		await page.locator('aside[aria-label="Ask"]').getByRole('button', { name: 'Send' }).click();
		// On a phone the panel gives way to the table the assistant opens.
		if (!onPhone()) await expect(page.getByTestId('thread').getByText('Ready.')).toBeVisible();

		await expect(page.getByRole('gridcell', { name: '10984', exact: true })).toBeVisible();
		await expect(
			page.getByRole('gridcell').getByRole('img', { name: '9 out of 10' })
		).toBeVisible();

		await expect
			.poll(() => fieldData(page, 'Year'))
			.toMatchObject({ type: 'number', grouping: false });
		await expect.poll(() => fieldData(page, 'Score')).toMatchObject({ type: 'rating', max: 10 });
	});
});

test.describe('the type picker', () => {
	test('adds a field of any type from the keyboard', async ({ page, context, account }) => {
		void account;
		const movies = await seedMovies(context.request);
		await page.goto(movies.grid);

		await page.getByRole('button', { name: 'Add a field' }).click();
		const popover = page.getByRole('dialog', { name: 'Add a field' });
		await popover.getByLabel('Field name').fill('Mood');
		await page.keyboard.press('Tab');
		const type = popover.getByRole('combobox', { name: 'Field type' });
		await expect(type).toBeFocused();
		await page.keyboard.type('ratin');
		await expect(page.getByRole('option')).toHaveText(['Rating']);
		await page.keyboard.press('Enter');
		await expect(type).toHaveValue('Rating');
		await page.keyboard.press('Tab');
		await page.keyboard.press('Enter');

		await expect(page.getByRole('columnheader', { name: 'Mood' })).toBeVisible();
		await expect.poll(() => fieldData(page, 'Mood')).toMatchObject({ type: 'rating' });
	});

	test('groups the types, and a new scale says what it clears', async ({
		page,
		context,
		account
	}) => {
		void account;
		const movies = await seedMovies(context.request);
		await page.goto(movies.grid);

		await columnMenu(page, 'Score', 'Field settings');
		const sheet = page.getByRole('dialog', { name: 'Field', exact: true });
		const type = sheet.getByRole('combobox').first();
		await expect(type).toHaveValue('Rating');
		await type.click();
		for (const group of ['Text', 'Numbers', 'Dates', 'Choices', 'Links and formulas']) {
			await expect(page.getByRole('group', { name: group })).toBeVisible();
		}
		await page.keyboard.press('Escape');

		await sheet.getByRole('combobox', { name: 'Highest' }).click();
		await page.getByRole('option', { name: '5', exact: true }).click();
		await expect(page.getByRole('status')).toContainText('Score retyped, 1 value cleared');
		await expect.poll(() => stored(page, movies)).toMatchObject({ Score: null });
	});
});
