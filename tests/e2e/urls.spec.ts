import type { APIRequestContext } from '@playwright/test';

import { createBase, createTable, createView, insertRows } from '../../src/lib/core/actions.ts';
import { expect, seed, tableMenu, tablePath, test, undoButton } from './harness.ts';

const at = (path: string): RegExp => new RegExp(`${path}$`, 'u');

function seedSeries(request: APIRequestContext) {
	return seed(request, (ws, commit) => {
		const base = createBase(ws, 'Tables');
		commit(base.changes);
		const series = createTable(ws, base.id, 'Séries', [{ name: 'Title', type: 'text' }]);
		commit(series.changes);
		commit(insertRows(ws, series.id, [{ [series.fieldIds[0]]: 'Severance' }]).changes);
		const watched = createView(ws, series.id, { name: 'Date watched', type: 'list', config: {} });
		commit(watched.changes);
		return { series: series.id, grid: series.viewIds[0], watched: watched.id };
	});
}

test('a table and its views are addressed by their names', async ({ page, context, account }) => {
	void account;
	const { series, grid } = await seedSeries(context.request);

	await page.goto('/app/t/series');
	await expect(page.getByRole('heading', { name: 'Séries' })).toBeVisible();

	const views = page.getByRole('group', { name: 'Views' });
	await views.getByRole('link', { name: 'Date watched' }).click();
	await expect(page).toHaveURL(at('/app/t/series/date-watched'));
	await views.getByRole('link', { name: 'Grid' }).click();
	await expect(page).toHaveURL(at('/app/t/series'));

	await page.goto(tablePath(series, grid));
	await expect(page).toHaveURL(at('/app/t/series'));
	await page.goto('/app/t/series/grid');
	await expect(page).toHaveURL(at('/app/t/series'));
	await expect(page.getByRole('gridcell', { name: 'Severance' })).toBeVisible();
});

test('a rename moves the address, and the old one still leads there', async ({
	page,
	context,
	account
}) => {
	void account;
	await seedSeries(context.request);
	await page.goto('/app/t/series/date-watched');

	await page.getByRole('heading', { name: 'Séries' }).getByRole('button').click();
	await page.getByRole('textbox', { name: 'Table name' }).fill('Shows to watch');
	await page.keyboard.press('Enter');
	await expect(page.getByRole('heading', { name: 'Shows to watch' })).toBeVisible();
	await expect(page).toHaveURL(at('/app/t/shows-to-watch/date-watched'));

	await undoButton(page).first().click();
	await expect(page.getByRole('heading', { name: 'Séries' })).toBeVisible();
	await expect(page).toHaveURL(at('/app/t/series/date-watched'));

	await page.reload();
	await expect(page.getByRole('heading', { name: 'Séries' })).toBeVisible();
});

test('two tables with one name each get their own address', async ({ page, context, account }) => {
	void account;
	await seed(context.request, (ws, commit) => {
		for (const [baseName, row] of [
			['Gym', 'Squat'],
			['Climbing', 'Boulder']
		]) {
			const base = createBase(ws, baseName);
			commit(base.changes);
			const sets = createTable(ws, base.id, 'Sets', [{ name: 'Name', type: 'text' }]);
			commit(sets.changes);
			commit(insertRows(ws, sets.id, [{ [sets.fieldIds[0]]: row }]).changes);
		}
	});

	await page.goto('/app');
	const links = page.getByRole('main').getByRole('link', { name: /^Sets/u });
	await expect(links).toHaveCount(2);
	const hrefs = await links.evaluateAll((items) => items.map((item) => item.getAttribute('href')));
	expect(hrefs).toContain('/app/t/sets');
	expect(hrefs).toContainEqual(expect.stringMatching(/^\/app\/t\/sets-[0-9a-z]{4}$/u));

	const shown = [];
	for (const href of hrefs) {
		await page.goto(href ?? '');
		await expect(page).toHaveURL(at(href ?? ''));
		shown.push(
			(await page.getByRole('gridcell', { name: /^(Squat|Boulder)$/u }).innerText()).trim()
		);
	}
	expect(shown.toSorted()).toEqual(['Boulder', 'Squat']);

	const twin = hrefs.find((href) => href !== '/app/t/sets') ?? '';
	await page.goto('/app/t/sets');
	await tableMenu(page, 'Delete table');
	await expect(page).toHaveURL(/\/app$/u);
	await expect(page.getByRole('main').getByRole('link', { name: /^Sets/u })).toHaveAttribute(
		'href',
		twin
	);
	await page.goto(twin);
	await expect(page.getByRole('heading', { name: 'Sets' })).toBeVisible();
	await expect(page).toHaveURL(at(twin));
});

test('an unknown address lands on the home with a word why', async ({ page, account }) => {
	void account;
	await page.goto('/app/t/nothing-here');
	await expect(page).toHaveURL(/\/app$/u);
	await expect(page.getByRole('status').filter({ hasText: 'Table not found' })).toBeVisible();
});

test('a name in another script keeps its letters in the address', async ({
	page,
	context,
	account
}) => {
	void account;
	const { courses } = await seed(context.request, (ws, commit) => {
		const base = createBase(ws, 'Tables');
		commit(base.changes);
		const made = createTable(ws, base.id, 'Курсы', [{ name: 'Name', type: 'text' }]);
		commit(made.changes);
		return { courses: made.id };
	});

	await page.goto(tablePath(courses));
	await expect(page.getByRole('heading', { name: 'Курсы' })).toBeVisible();
	await expect(page).toHaveURL(at(`/app/t/${encodeURIComponent('курсы')}`));
	await page.reload();
	await expect(page.getByRole('heading', { name: 'Курсы' })).toBeVisible();
	await expect(page).toHaveURL(at(`/app/t/${encodeURIComponent('курсы')}`));
});
