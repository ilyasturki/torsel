import type { APIRequestContext, Browser, Page } from '@playwright/test';

import { createBase, createTable, createView, insertRows } from '../../src/lib/core/actions.ts';
import { expect, newAddress, seed, tableMenu, tablePath, test, watchErrors } from './harness.ts';

const SECRET = 'SENTINEL the hidden note';

function seedGarden(request: APIRequestContext) {
	return seed(request, (ws, commit) => {
		const base = createBase(ws, 'Garden');
		commit(base.changes);
		const plants = createTable(
			ws,
			base.id,
			'Plants',
			[
				{ name: 'Name', type: 'text' },
				{ name: 'Note', type: 'text' },
				{ name: 'Kg', type: 'number' },
				{ name: 'Kind', type: 'choice', choices: [{ name: 'Herb', color: null }] }
			],
			() => []
		);
		commit(plants.changes);
		const [name, note, kg, kind] = plants.fieldIds;
		commit(
			insertRows(ws, plants.id, [
				{ [name]: 'Basil', [note]: SECRET, [kg]: 2, [kind]: 'Herb' },
				{ [name]: 'Mint', [note]: SECRET, [kg]: 9, [kind]: 'Herb' }
			]).changes
		);
		const grid = createView(ws, plants.id, {
			name: 'Public',
			type: 'grid',
			config: { hidden: [note], sort: [{ field: kg, dir: 'desc' }] }
		});
		commit(grid.changes);
		const chart = createView(ws, plants.id, {
			name: 'Weight',
			type: 'chart',
			config: { kind: 'bar', x: kind, agg: 'sum', y: kg }
		});
		commit(chart.changes);
		return { grid: tablePath(plants.id, grid.id), chart: tablePath(plants.id, chart.id) };
	});
}

async function publish(page: Page): Promise<string> {
	await tableMenu(page, 'Publish to web');
	const dialog = page.getByRole('dialog', { name: 'Publish to web' });
	await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
	const link = dialog.getByRole('textbox', { name: 'Link' });
	await expect(link).toHaveValue(/\/v\/[\w-]{22}$/u);
	return link.inputValue();
}

/** A visitor with no account, at this project's viewport, whose every response body is kept. */
async function visitor(browser: Browser, errors: string[]) {
	const { viewport, isMobile, hasTouch, userAgent, deviceScaleFactor } = test.info().project.use;
	const context = await browser.newContext({
		viewport,
		isMobile,
		hasTouch,
		userAgent,
		deviceScaleFactor,
		extraHTTPHeaders: { 'x-forwarded-for': newAddress() }
	});
	const page = await context.newPage();
	watchErrors(page, errors);
	const bodies: Promise<string>[] = [];
	page.on('response', (response) => {
		bodies.push(response.text().catch(() => ''));
	});
	return { context, page, bodies: async () => (await Promise.all(bodies)).join('\n') };
}

test('a published grid shows what its view shows, read only, until it is unpublished', async ({
	page,
	context,
	browser,
	account
}) => {
	void account;
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	const paths = await seedGarden(page.request);
	await page.goto(paths.grid);
	const link = await publish(page);

	const dialog = page.getByRole('dialog', { name: 'Publish to web' });
	await dialog.getByRole('button', { name: 'Copy link' }).click();
	await expect(page.getByRole('status').getByText('Link copied')).toBeVisible();
	await page.keyboard.press('Escape');

	const errors: string[] = [];
	const guest = await visitor(browser, errors);
	await guest.page.goto(link);

	const grid = guest.page.getByRole('grid');
	await expect(guest.page.getByText('Public', { exact: true })).toBeVisible();
	await expect(guest.page.getByText('Made with Torsel')).toBeVisible();
	await expect(grid.getByRole('columnheader')).toHaveText(['Name', 'Kg', 'Kind']);
	await expect(grid.getByRole('row').nth(1)).toContainText('Mint');
	await expect(grid.getByRole('row').nth(2)).toContainText('Basil');

	await grid.getByRole('gridcell', { name: 'Mint', exact: true }).dblclick();
	await guest.page.keyboard.type('x');
	await expect(grid.getByRole('textbox')).toHaveCount(0);
	await expect(grid.getByRole('button')).toHaveCount(0);
	await expect(guest.page.getByRole('menu')).toHaveCount(0);
	await expect(grid.getByRole('gridcell', { name: 'Mint', exact: true })).toBeVisible();

	expect(await guest.bodies()).not.toContain('SENTINEL');

	await tableMenu(page, 'Publish to web');
	await dialog.getByRole('button', { name: 'Unpublish' }).click();
	await expect(page.getByRole('status').getByText('Public unpublished')).toBeVisible();

	await guest.page.reload();
	await expect(guest.page.getByText('This link no longer works')).toBeVisible();
	await guest.context.close();
	expect(errors).toEqual([]);
});

test('a published chart sends its figures, never its rows', async ({ page, browser, account }) => {
	void account;
	const paths = await seedGarden(page.request);
	await page.goto(paths.chart);
	const link = await publish(page);

	const errors: string[] = [];
	const guest = await visitor(browser, errors);
	await guest.page.goto(link);
	await expect(guest.page.getByText('Weight', { exact: true })).toBeVisible();
	await expect(guest.page.getByText('11', { exact: true })).toBeVisible();
	await expect(guest.page.getByTestId('chart-line')).toHaveCount(0);

	const bodies = await guest.bodies();
	expect(bodies).not.toContain('Basil');
	expect(bodies).not.toContain('SENTINEL');
	await guest.context.close();
	expect(errors).toEqual([]);
});

test('a link that opens nothing says so', async ({ page }) => {
	await page.goto('/v/AAAAAAAAAAAAAAAAAAAAAA');
	await expect(page.getByText('This link no longer works')).toBeVisible();
});

test.describe('in French', () => {
	test.use({ locale: 'fr-FR' });

	test('the table menu offers to publish the view on the web', async ({ page, account }) => {
		void account;
		const paths = await seedGarden(page.request);
		await page.goto(paths.grid);
		await page.getByRole('button', { name: 'Plus', exact: true }).click();
		await page
			.getByRole('menuitem', { name: 'Publier sur le web' })
			.or(page.getByRole('dialog').getByRole('button', { name: 'Publier sur le web' }))
			.click();
		const dialog = page.getByRole('dialog', { name: 'Publier sur le web' });
		await expect(dialog.getByRole('button', { name: 'Publier', exact: true })).toBeVisible();
	});
});
