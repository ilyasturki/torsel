import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { APIRequestContext, Browser, Locator, Page } from '@playwright/test';

import { createBase, createTable, createView, insertRows } from '../../src/lib/core/actions.ts';
import { newId } from '../../src/lib/core/ids.ts';
import type { ImageRef } from '../../src/lib/core/images.ts';
import {
	RETRY_RESET,
	expect,
	newAddress,
	seed,
	tableMenu,
	tablePath,
	test,
	watchErrors
} from './harness.ts';

const SECRET = 'SENTINEL the hidden note';
const POSTER = readFileSync(join(import.meta.dirname, 'images/poster.jpg'));
const STILL = readFileSync(join(import.meta.dirname, 'images/still.jpg'));

async function upload(request: APIRequestContext, base: string, bytes: Buffer): Promise<ImageRef> {
	const id = createHash('sha256').update(bytes).digest('hex');
	const response = await request.post(`/api/blobs/${base}/${id}?size=${bytes.length}&offset=0`, {
		...RETRY_RESET,
		headers: { 'content-type': 'application/octet-stream' },
		data: bytes
	});
	expect(response.ok(), 'uploading an image').toBe(true);
	return ((await response.json()) as { ref: ImageRef }).ref;
}

/** Two books on a cover wall; Dune's back cover sits in a field the list doesn't show. */
async function seedShelf(request: APIRequestContext): Promise<{ wall: string; hidden: string }> {
	const baseId = newId('b');
	const cover = await upload(request, baseId, POSTER);
	const back = await upload(request, baseId, STILL);
	const wall = await seed(request, (ws, commit) => {
		commit([
			{ id: baseId, kind: 'base', base: baseId, parent: '', set: { name: 'Shelf', order: 0 } }
		]);
		const books = createTable(
			ws,
			baseId,
			'Books',
			[
				{ name: 'Title', type: 'text' },
				{ name: 'Cover', type: 'image' },
				{ name: 'Back', type: 'image' }
			],
			() => []
		);
		commit(books.changes);
		const [title, front, rear] = books.fieldIds;
		commit(
			insertRows(ws, books.id, [
				{ [title]: 'Dune', [front]: [cover], [rear]: [back] },
				{ [title]: 'Alien' }
			]).changes
		);
		const view = createView(ws, books.id, {
			name: 'Wall',
			type: 'list',
			config: { title, cover: front, show: [], group: null }
		});
		commit(view.changes);
		return tablePath(books.id, view.id);
	});
	return { wall, hidden: back.id };
}

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

test('a published list shows its covers, and no image it doesn’t show', async ({
	page,
	browser,
	account
}) => {
	void account;
	const shelf = await seedShelf(page.request);
	await page.goto(shelf.wall);
	const link = await publish(page);

	const errors: string[] = [];
	const guest = await visitor(browser, errors);
	await guest.page.goto(link);
	await expect(guest.page.getByText('Dune', { exact: true })).toBeVisible();
	await expect(guest.page.getByText('Alien', { exact: true })).toBeVisible();
	await expect(guest.page.getByRole('button', { name: 'Dune' })).toHaveCount(0);
	const cover = guest.page.locator('main img').first();
	await expect
		.poll(() => cover.evaluate((image: HTMLImageElement) => image.naturalWidth))
		.toBeGreaterThan(0);

	expect(await guest.bodies()).not.toContain(shelf.hidden);
	const refused = await guest.context.request.get(`${link}/files/${shelf.hidden}`, RETRY_RESET);
	expect(refused.status()).toBe(404);
	await guest.context.close();
	expect(errors).toEqual([]);
});

async function expectCentred(page: Page, heading: Locator): Promise<void> {
	const box = await heading.boundingBox();
	const width = page.viewportSize()?.width ?? 0;
	expect(box).not.toBeNull();
	expect(Math.abs((box?.x ?? 0) + (box?.width ?? 0) / 2 - width / 2)).toBeLessThan(2);
}

test('a link that opens nothing says so, centred, with a way to Torsel', async ({ page }) => {
	await page.goto('/v/AAAAAAAAAAAAAAAAAAAAAA');
	const heading = page.getByRole('heading', { name: 'This link no longer works' });
	await expect(heading).toBeVisible();
	await expect(page.getByText('Its owner stopped sharing it.')).toBeVisible();
	await expect(page.getByRole('link', { name: 'Go to Torsel' })).toHaveAttribute('href', '/');
	await expect(page).toHaveTitle('This link no longer works');
	await expectCentred(page, heading);
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

	test('a dead link says so in French', async ({ page }) => {
		await page.goto('/v/AAAAAAAAAAAAAAAAAAAAAA');
		const heading = page.getByRole('heading', { name: 'Ce lien ne fonctionne plus' });
		await expect(heading).toBeVisible();
		await expect(page.getByText('Son propriétaire a arrêté de le partager.')).toBeVisible();
		await expect(page.getByRole('link', { name: 'Aller sur Torsel' })).toHaveAttribute(
			'href',
			'/fr'
		);
		await expectCentred(page, heading);
	});
});
