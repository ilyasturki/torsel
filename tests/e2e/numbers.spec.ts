import type { APIRequestContext, Locator, Page } from '@playwright/test';

import { createBase, createTable, insertRows } from '../../src/lib/core/actions.ts';
import type { Rec } from '../../src/lib/core/model.ts';
import { expect, seed, tablePath, test } from './harness.ts';

type Movies = {
	grid: string;
	entry: string;
	table: string;
	year: string;
	budget: string;
	seen: string;
};

function seedMovies(request: APIRequestContext): Promise<Movies> {
	return seed(request, (ws, commit) => {
		const base = createBase(ws, 'Films');
		commit(base.changes);
		const table = createTable(ws, base.id, 'Movies', [
			{ name: 'Title', type: 'text' },
			{ name: 'Year', type: 'number' },
			{ name: 'Budget', type: 'number' },
			{ name: 'Seen', type: 'date' }
		]);
		commit(table.changes);
		const [title, year, budget, seen] = table.fieldIds;
		commit(
			insertRows(ws, table.id, [
				{ [title]: 'Dune', [year]: 2024, [budget]: 190000, [seen]: '2024-03-01T20:30' }
			]).changes
		);
		return {
			grid: tablePath(table.id, table.viewIds[0]),
			entry: tablePath(table.id, table.viewIds[1]),
			table: table.id,
			year,
			budget,
			seen
		};
	});
}

async function storedRows(page: Page, table: string): Promise<Rec[]> {
	const pull = await page.context().request.post('/api/sync', { data: { watermark: 0, push: [] } });
	const { records } = (await pull.json()) as { records: Rec[] };
	return records.filter((rec) => rec.kind === 'row' && rec.parent === table);
}

/** Changes the last character of what the input shows, the way a person corrects a value. */
async function retypeLast(input: Locator, char: string): Promise<void> {
	await input.click();
	await input.press('End');
	await input.press('Backspace');
	await input.pressSequentially(char);
}

const LOCALES = [
	{ locale: 'en-US', budget: '190,000', edited: '190,001', seen: 'Mar 1, 2024 8:30 PM' },
	{ locale: 'fr-FR', budget: '190 000', edited: '190 001', seen: '1 mars 2024 20:30' }
];

for (const { locale, budget, edited, seen } of LOCALES) {
	test.describe(`numbers and dates in ${locale}`, () => {
		test.use({ locale });

		test('the grid shows a year whole, groups larger numbers, and shows the time in the locale', async ({
			page,
			context,
			account
		}) => {
			void account;
			const movies = await seedMovies(context.request);
			await page.goto(movies.grid);

			await expect(page.getByRole('gridcell', { name: '2024', exact: true })).toBeVisible();
			await expect(page.getByRole('gridcell', { name: budget, exact: true })).toBeVisible();
			await expect(page.getByRole('gridcell', { name: seen, exact: true })).toBeVisible();
		});

		test('a tap on a timed date opens a picker with its time', async ({
			page,
			context,
			account
		}) => {
			test.skip(test.info().project.name !== 'phone', 'the native picker opens on a touch');
			void account;
			await page.addInitScript(() => {
				HTMLInputElement.prototype.showPicker = () => undefined;
			});
			const movies = await seedMovies(context.request);
			await page.goto(movies.grid);

			const stored = page.getByRole('gridcell', { name: seen, exact: true });
			await stored.scrollIntoViewIfNeeded();
			await stored.tap();
			const picker = page.getByRole('gridcell').locator('input');
			await expect(picker).toHaveAttribute('type', 'datetime-local');
			await expect(picker).toHaveValue('2024-03-01T20:30');
		});

		test('the row sheet opens on what the grid shows and stores what was typed', async ({
			page,
			context,
			account
		}) => {
			void account;
			const movies = await seedMovies(context.request);
			await page.goto(movies.grid);

			await page.getByRole('button', { name: 'Open row' }).first().click();
			const sheet = page.getByRole('dialog', { name: 'Row' });
			const year = sheet.getByLabel('Year');
			const money = sheet.getByLabel('Budget');
			const when = sheet.getByLabel('Seen');
			await expect(year).toHaveValue('2024');
			await expect(money).toHaveValue(budget);
			await expect(when).toHaveAttribute('type', 'datetime-local');
			await expect(when).toHaveValue('2024-03-01T20:30');

			await retypeLast(year, '5');
			await retypeLast(money, '1');
			await expect(money).toHaveValue(edited);
			await when.fill('2024-03-02T07:45');
			await sheet.getByRole('button', { name: 'Save' }).click();
			await expect(sheet).toHaveCount(0);

			await expect
				.poll(async () => (await storedRows(page, movies.table))[0]?.data)
				.toMatchObject({
					[movies.year]: 2025,
					[movies.budget]: 190001,
					[movies.seen]: '2024-03-02T07:45'
				});
		});

		test('entry opens on what the grid shows and stores what was typed', async ({
			page,
			context,
			account
		}) => {
			void account;
			const movies = await seedMovies(context.request);
			await page.goto(movies.entry);

			const year = page.getByRole('textbox', { name: 'Year' });
			const money = page.getByRole('textbox', { name: 'Budget' });
			await expect(year).toHaveValue('2024');
			await expect(money).toHaveValue(budget);
			await expect(page.getByLabel('Seen')).toHaveAttribute('type', 'datetime-local');

			await retypeLast(year, '3');
			await retypeLast(money, '1');
			await page.getByRole('button', { name: 'Add row' }).click();

			await expect
				.poll(async () =>
					(await storedRows(page, movies.table)).map((row) => [
						row.data[movies.year],
						row.data[movies.budget],
						/T\d{2}:\d{2}$/u.test(String(row.data[movies.seen]))
					])
				)
				.toContainEqual([2023, 190001, true]);
		});
	});
}
