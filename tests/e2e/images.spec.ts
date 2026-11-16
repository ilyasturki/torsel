import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { APIRequestContext, Locator, Page } from '@playwright/test';

import names from '../../src/lib/i18n/names.ts';
import { createBase, createTable, createView, insertRows } from '../../src/lib/core/actions.ts';
import type { ImageRef } from '../../src/lib/core/images.ts';
import type { Change, Rec } from '../../src/lib/core/model.ts';
import { Workspace } from '../../src/lib/core/workspace.ts';

import { RETRY_RESET, expect, newAccount, seed, signIn, tablePath, test } from './harness.ts';

const POSTER = readFileSync(join(import.meta.dirname, 'images/poster.jpg'));
const STILL = readFileSync(join(import.meta.dirname, 'images/still.jpg'));

const sha = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

/** Stores bytes as they are, in one part, the way a device sends them. */
async function upload(
	request: APIRequestContext,
	base: string,
	bytes: Buffer
): Promise<{ status: number; ref?: ImageRef }> {
	const response = await request.post(
		`/api/blobs/${base}/${sha(bytes)}?size=${bytes.length}&offset=0`,
		{ ...RETRY_RESET, headers: { 'content-type': 'application/octet-stream' }, data: bytes }
	);
	const body = response.ok() ? await response.json() : {};
	return { status: response.status(), ref: body.ref };
}

type Movies = { base: string; grid: string; list: string; rows: string[] };

/** Dune and Alien in a Movies table with a Poster field, a grid and a "By status" poster wall; `posters` fills Dune's. */
function seedMovies(request: APIRequestContext, posters: ImageRef[] = []): Promise<Movies> {
	return seed(request, (ws, commit) => {
		const base = createBase(ws, 'Films');
		commit(base.changes);
		const movies = createTable(
			ws,
			base.id,
			'Movies',
			[
				{ name: 'Title', type: 'text' },
				{ name: 'Poster', type: 'image' },
				{
					name: 'Status',
					type: 'choice',
					choices: [
						{ name: 'to watch', color: 'orange' },
						{ name: 'watched', color: 'amber' }
					]
				}
			],
			() => [{ name: names.en.views.grid, type: 'grid', config: {} }]
		);
		commit(movies.changes);
		const [title, poster, status] = movies.fieldIds;
		const list = createView(ws, movies.id, {
			name: 'By status',
			type: 'list',
			config: { group: status, title, cover: poster, show: [] }
		});
		commit(list.changes);
		const rows = insertRows(ws, movies.id, [
			{ [title]: 'Dune', [status]: 'watched', [poster]: posters.length > 0 ? posters : null },
			{ [title]: 'Alien', [status]: 'to watch' }
		]);
		commit(rows.changes);
		return {
			base: base.id,
			grid: tablePath(movies.id),
			list: tablePath(movies.id, list.id),
			rows: rows.ids
		};
	});
}

const posterCell = (page: Page, title: string): Locator =>
	page.getByRole('row').filter({ hasText: title }).locator('td[aria-colindex="3"]');

async function serverValue(request: APIRequestContext, row: string): Promise<ImageRef[] | null> {
	const response = await request.post('/api/sync', {
		...RETRY_RESET,
		data: { watermark: 0, push: [] }
	});
	const { records } = (await response.json()) as { records: Rec[] };
	const rec = records.find((record) => record.id === row);
	const value = Object.values(rec?.data ?? {}).find(Array.isArray);
	return (value as ImageRef[] | undefined) ?? null;
}

async function expectPosterShape(image: Locator, ratio: number): Promise<void> {
	await expect(image).toBeVisible();
	await expect
		.poll(async () => {
			const box = await image.boundingBox();
			return box === null ? 0 : Math.round((box.height / box.width) * 100) / 100;
		})
		.toBeCloseTo(ratio, 1);
}

test('an image from a file shows in its cell whole, and Space opens it', async ({
	page,
	context,
	account
}) => {
	void account;
	const movies = await seedMovies(context.request);
	await page.goto(movies.grid);

	await posterCell(page, 'Dune').click();
	await page.keyboard.press('Enter');
	const sheet = page.getByRole('dialog', { name: 'Poster' });
	await sheet.locator('input[type="file"]:not([capture])').setInputFiles({
		name: 'dune.jpg',
		mimeType: 'image/jpeg',
		buffer: POSTER
	});
	await expect(sheet.getByRole('button', { name: 'dune.jpg', exact: true })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(sheet).toBeHidden();

	const thumb = posterCell(page, 'Dune').getByRole('img');
	await expectPosterShape(thumb, 1.5);
	const rowHeight = (await posterCell(page, 'Dune').boundingBox())?.height ?? 0;
	expect((await thumb.boundingBox())?.height).toBeCloseTo(rowHeight - 8, 0);

	await posterCell(page, 'Dune').click();
	await page.keyboard.press('Space');
	const lightbox = page.getByRole('dialog', { name: 'Poster' });
	await expect(lightbox.getByRole('img', { name: 'dune.jpg' })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(lightbox).toBeHidden();

	await expect.poll(() => serverValue(context.request, movies.rows[0])).toHaveLength(1);
});

test('a pasted image lands in the selected cell, and in the row sheet', async ({
	page,
	context,
	account
}) => {
	void account;
	const movies = await seedMovies(context.request);
	await page.goto(movies.grid);

	const paste = async (target: Locator): Promise<void> => {
		await target.evaluate(
			(element, bytes) => {
				const data = new DataTransfer();
				data.items.add(new File([new Uint8Array(bytes)], 'image.png', { type: 'image/jpeg' }));
				element.dispatchEvent(
					new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
				);
			},
			[...POSTER]
		);
	};

	await posterCell(page, 'Alien').click();
	await page.keyboard.press('ControlOrMeta+v');
	await paste(page.locator('textarea[aria-hidden="true"]').first());
	await expect(posterCell(page, 'Alien').getByRole('img')).toHaveCount(1);
	await expect(page.getByRole('status')).toContainText('Image added');

	await posterCell(page, 'Alien').click();
	await page.keyboard.press('Enter');
	const sheet = page.getByRole('dialog', { name: 'Poster' });
	await paste(sheet.getByRole('group', { name: 'Poster' }));
	await expect(sheet.getByRole('button', { name: /^image/u })).toHaveCount(1);
	await paste(sheet.getByRole('group', { name: 'Poster' }));
	await expect(sheet.getByRole('button', { name: /^image/u })).toHaveCount(1);
});

test('an image added offline waits on the device, then reaches the server and another device', async ({
	page,
	context,
	browser,
	baseURL,
	account
}) => {
	const movies = await seedMovies(context.request);
	await page.goto(movies.grid);
	await expect(posterCell(page, 'Dune')).toBeVisible();

	await context.setOffline(true);
	await posterCell(page, 'Dune').click();
	await page.keyboard.press('Enter');
	const sheet = page.getByRole('dialog', { name: 'Poster' });
	await sheet.locator('input[type="file"]:not([capture])').setInputFiles({
		name: 'dune.jpg',
		mimeType: 'image/jpeg',
		buffer: POSTER
	});
	await expect(sheet.getByRole('img', { name: 'dune.jpg' })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(posterCell(page, 'Dune').getByRole('img')).toBeVisible();
	await expect(page.getByText('Offline, 1 change waiting')).toBeVisible();

	await context.setOffline(false);
	await expect.poll(() => serverValue(context.request, movies.rows[0])).toHaveLength(1);
	const [ref] = (await serverValue(context.request, movies.rows[0])) ?? [];
	const stored = await context.request.get(`/api/blobs/${movies.base}/${ref.id}`, RETRY_RESET);
	expect(stored.status()).toBe(200);
	expect(sha(await stored.body())).toBe(ref.id);

	const other = await browser.newContext({ baseURL });
	await signIn(other, account);
	const phone = await other.newPage();
	await phone.goto(movies.grid);
	await expectPosterShape(posterCell(phone, 'Dune').getByRole('img'), ref.h / ref.w);
	await other.close();
});

test('the poster wall shows each row’s cover whole, and the lightbox steps through a cell', async ({
	page,
	context,
	account
}) => {
	void account;
	// The images go up first, to the base the rows will name.
	const films = createBase(new Workspace(), 'Films');
	const poster = (await upload(context.request, films.id, POSTER)).ref as ImageRef;
	const still = (await upload(context.request, films.id, STILL)).ref as ImageRef;
	const movies = await seedFor(context.request, films, [
		{ ...poster, name: 'dune.jpg' },
		{ ...still, name: 'still.jpg' }
	]);
	await page.goto(movies.list);

	const card = page.getByRole('button', { name: 'Poster' });
	await expect(card).toHaveCount(1);
	await expectPosterShape(card.getByRole('img'), 1.5);
	await expect(page.getByRole('button', { name: 'Dune', exact: true })).toBeVisible();
	await expect(page.getByRole('heading', { name: /watched/u })).toBeVisible();

	await card.click();
	const lightbox = page.getByRole('dialog', { name: 'Poster' });
	await expect(lightbox.getByRole('img', { name: 'dune.jpg' })).toBeVisible();
	await expect(lightbox.getByRole('button', { name: 'Close' })).toBeFocused();
	await page.keyboard.press('ArrowRight');
	await expect(lightbox.getByRole('img', { name: 'still.jpg' })).toBeVisible();
	await expect(lightbox.getByText('2 of 2')).toBeVisible();
	const shown = await lightbox.getByRole('img', { name: 'still.jpg' }).boundingBox();
	expect((shown?.width ?? 0) / (shown?.height ?? 1)).toBeCloseTo(600 / 338, 1);
	await page.keyboard.press('ArrowRight');
	await expect(lightbox.getByText('1 of 2')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(lightbox).toBeHidden();

	await page.getByRole('button', { name: 'Dune', exact: true }).click();
	await expect(
		page.getByRole('dialog').getByRole('button', { name: 'dune.jpg', exact: true })
	).toBeVisible();
});

/** `seedMovies` in a base made beforehand, whose images are already on the server. */
function seedFor(
	request: APIRequestContext,
	base: { id: string; changes: Change[] },
	posters: ImageRef[]
): Promise<Movies> {
	return seed(request, (ws, commit) => {
		commit(base.changes);
		const movies = createTable(
			ws,
			base.id,
			'Movies',
			[
				{ name: 'Title', type: 'text' },
				{ name: 'Poster', type: 'image' },
				{ name: 'Status', type: 'choice', choices: [{ name: 'watched', color: 'amber' }] }
			],
			() => [{ name: names.en.views.grid, type: 'grid', config: {} }]
		);
		commit(movies.changes);
		const [title, poster, status] = movies.fieldIds;
		const list = createView(ws, movies.id, {
			name: 'By status',
			type: 'list',
			config: { group: status, title, cover: poster, show: [] }
		});
		commit(list.changes);
		const rows = insertRows(ws, movies.id, [
			{ [title]: 'Dune', [status]: 'watched', [poster]: posters }
		]);
		commit(rows.changes);
		return {
			base: base.id,
			grid: tablePath(movies.id),
			list: tablePath(movies.id, list.id),
			rows: rows.ids
		};
	});
}

test.describe('uploads', () => {
	test.skip(({ isMobile }) => isMobile, 'the server answers every viewport alike');

	test('only images are kept, and they are served so they can never run', async ({
		context,
		browser,
		baseURL,
		account
	}) => {
		void account;
		const { base } = await seedMovies(context.request);
		const svg = Buffer.from(
			'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>'
		);
		const html = Buffer.from('<!doctype html><script>alert(document.cookie)</script>');

		expect((await upload(context.request, base, svg)).status).toBe(415);
		expect((await upload(context.request, base, html)).status).toBe(415);

		const forged = await context.request.post(
			`/api/blobs/${base}/${sha(STILL)}?size=${POSTER.length}&offset=0`,
			{ ...RETRY_RESET, headers: { 'content-type': 'application/octet-stream' }, data: POSTER }
		);
		expect(forged.status()).toBe(422);

		const tooBig = await context.request.post(
			`/api/blobs/${base}/${sha(POSTER)}?size=${11 * 1024 * 1024}&offset=0`,
			{ ...RETRY_RESET, headers: { 'content-type': 'application/octet-stream' }, data: POSTER }
		);
		expect(tooBig.status()).toBe(413);

		const { ref } = await upload(context.request, base, POSTER);
		expect(ref).toEqual({
			id: sha(POSTER),
			type: 'image/jpeg',
			w: 342,
			h: 513,
			size: POSTER.length
		});

		const served = await context.request.get(`/api/blobs/${base}/${sha(POSTER)}`, RETRY_RESET);
		expect(served.status()).toBe(200);
		expect(served.headers()['content-type']).toBe('image/jpeg');
		expect(served.headers()['x-content-type-options']).toBe('nosniff');
		expect(served.headers()['content-security-policy']).toBe("default-src 'none'; sandbox");
		expect(served.headers()['cache-control']).toBe('private, max-age=31536000, immutable');

		const stranger = await browser.newContext({ baseURL });
		const anonymous = await stranger.request.get(`/api/blobs/${base}/${sha(POSTER)}`, RETRY_RESET);
		expect(anonymous.status()).toBe(401);
		await stranger.close();
	});

	test('one account never reads another’s images, whatever the base is called', async ({
		context,
		browser,
		baseURL,
		account
	}) => {
		void account;
		const { base } = await seedMovies(context.request);
		await upload(context.request, base, POSTER);

		const other = await browser.newContext({ baseURL });
		await signIn(other, newAccount());
		const read = await other.request.get(`/api/blobs/${base}/${sha(POSTER)}`, RETRY_RESET);
		expect(read.status()).toBe(404);
		await other.close();
	});
});
