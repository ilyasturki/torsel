import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { APIRequestContext, Locator, Page } from '@playwright/test';

import names from '../../src/lib/i18n/names.ts';
import { createBase, createTable, createView, insertRows } from '../../src/lib/core/actions.ts';
import type { ImageRef } from '../../src/lib/core/images.ts';
import { Hlc } from '../../src/lib/core/clock.ts';
import type { Change, Rec } from '../../src/lib/core/model.ts';
import { Workspace } from '../../src/lib/core/workspace.ts';

import {
	RETRY_RESET,
	columnMenu,
	expect,
	newAccount,
	pick,
	seed,
	signIn,
	tableMenu,
	tablePath,
	test
} from './harness.ts';

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

	// Images can't travel as text, so a cut copies them and leaves them in place.
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	await page.keyboard.press('Control+X');
	await expect(page.getByRole('status')).toContainText('Copied');
	await expect(posterCell(page, 'Dune').getByRole('img')).toBeVisible();

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
	await expectPosterShape(lightbox.getByRole('img', { name: 'still.jpg' }), 338 / 600);
	await page.keyboard.press('ArrowRight');
	await expect(lightbox.getByText('1 of 2')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(lightbox).toBeHidden();

	await page.getByRole('button', { name: 'Dune', exact: true }).click();
	await expect(
		page.getByRole('dialog').getByRole('button', { name: 'dune.jpg', exact: true })
	).toBeVisible();

	const sheet = page.getByRole('dialog');
	await sheet.locator('input[type="file"]:not([capture])').setInputFiles({
		name: 'set.jpg',
		mimeType: 'image/jpeg',
		buffer: STILL
	});
	await expect(sheet.getByRole('button', { name: 'set.jpg', exact: true })).toBeVisible();
	await expect.poll(() => serverValue(context.request, movies.rows[0])).toHaveLength(3);
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

/** The "Add" button's own file chooser: straight away on a desktop, through Choose an image on a phone. */
async function chooseImage(
	page: Page,
	scope: Locator,
	name: string,
	buffer: Buffer
): Promise<void> {
	const chooser = page.waitForEvent('filechooser');
	await scope.getByRole('button', { name: 'Add', exact: true }).click();
	if (test.info().project.name === 'phone') {
		await expect(page.getByRole('menuitem', { name: 'Take a photo' })).toBeVisible();
		await page.getByRole('menuitem', { name: 'Choose an image' }).click();
	}
	await (await chooser).setFiles({ name, mimeType: 'image/jpeg', buffer });
}

test('Entry logs a row with its image, and the next row starts without it', async ({
	page,
	context,
	account
}) => {
	void account;
	const made = await seed(context.request, (ws, commit) => {
		const base = createBase(ws, 'Films');
		commit(base.changes);
		const table = createTable(
			ws,
			base.id,
			'Watched',
			[
				{ name: 'Title', type: 'text' },
				{ name: 'Poster', type: 'image' }
			],
			() => [{ name: names.en.views.entry, type: 'entry', config: { match: [] } }]
		);
		commit(table.changes);
		return { path: tablePath(table.id), table: table.id };
	});
	await page.goto(made.path);

	await page.getByLabel('Title').fill('Heat');
	await chooseImage(page, page.getByRole('group', { name: 'Poster' }), 'heat.jpg', POSTER);
	await expect(page.getByRole('button', { name: 'heat.jpg', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Add row' }).click();

	await expect(page.getByRole('button', { name: 'heat.jpg', exact: true })).toBeHidden();
	await expect
		.poll(async () => {
			const response = await context.request.post('/api/sync', {
				...RETRY_RESET,
				data: { watermark: 0, push: [] }
			});
			const { records } = (await response.json()) as { records: Rec[] };
			const row = records.find((record) => record.kind === 'row' && record.parent === made.table);
			return Object.values(row?.data ?? {}).find(Array.isArray)?.length ?? 0;
		})
		.toBe(1);
});

test('a dropped image lands in the cell, and the file chooser adds another', async ({
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
	const group = sheet.getByRole('group', { name: 'Poster' });

	await group.evaluate(
		(element, bytes) => {
			const data = new DataTransfer();
			data.items.add(new File([new Uint8Array(bytes)], 'dropped.jpg', { type: 'image/jpeg' }));
			for (const type of ['dragover', 'drop']) {
				element.dispatchEvent(
					new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true })
				);
			}
		},
		[...STILL]
	);
	await expect(sheet.getByRole('button', { name: 'dropped.jpg', exact: true })).toBeVisible();

	await chooseImage(page, sheet, 'chosen.jpg', POSTER);
	await expect(sheet.getByRole('button', { name: 'chosen.jpg', exact: true })).toBeVisible();
	await expect.poll(() => serverValue(context.request, movies.rows[0])).toHaveLength(2);
});

test('a device on the first local store keeps its unsent rows and takes images', async ({
	page,
	context,
	account
}) => {
	void account;
	const ws = new Workspace();
	const hlc = new Hlc('before-images');
	const records: Rec[] = [];
	const commit = (changes: Change[]): void => {
		for (const change of changes) records.push(ws.stamp(change, hlc.tick()).rec);
	};
	const base = createBase(ws, 'Films');
	commit(base.changes);
	const table = createTable(
		ws,
		base.id,
		'Movies',
		[
			{ name: 'Title', type: 'text' },
			{ name: 'Poster', type: 'image' }
		],
		() => [{ name: names.en.views.grid, type: 'grid', config: {} }]
	);
	commit(table.changes);
	const rows = insertRows(ws, table.id, [{ [table.fieldIds[0]]: 'Dune' }]);
	commit(rows.changes);
	const latest = new Map(records.map((rec) => [rec.id, rec]));

	await page.goto('/api/health');
	await page.evaluate(
		async (json) => {
			const stored = JSON.parse(json) as { id: string }[];
			await new Promise((resolve, reject) => {
				const open = indexedDB.open('torsel', 1);
				open.onupgradeneeded = () => {
					open.result.createObjectStore('records', { keyPath: 'id' });
					open.result.createObjectStore('meta');
				};
				open.onerror = () => reject(open.error);
				open.onsuccess = () => {
					const tx = open.result.transaction('records', 'readwrite');
					for (const rec of stored) tx.objectStore('records').put({ id: rec.id, rec, dirty: true });
					tx.oncomplete = () => {
						open.result.close();
						resolve(null);
					};
					tx.onerror = () => reject(tx.error);
				};
			});
		},
		JSON.stringify([...latest.values()])
	);

	await page.goto(tablePath(table.id));
	await expect(posterCell(page, 'Dune')).toBeVisible();
	await expect.poll(() => serverValue(context.request, rows.ids[0])).toBeNull();
	const pushed = await context.request.post('/api/sync', {
		...RETRY_RESET,
		data: { watermark: 0, push: [] }
	});
	expect(JSON.stringify(await pushed.json())).toContain('Dune');

	await posterCell(page, 'Dune').click();
	await page.keyboard.press('Enter');
	const sheet = page.getByRole('dialog', { name: 'Poster' });
	await sheet.locator('input[type="file"]:not([capture])').setInputFiles({
		name: 'dune.jpg',
		mimeType: 'image/jpeg',
		buffer: POSTER
	});
	await expect(sheet.getByRole('button', { name: 'dune.jpg', exact: true })).toBeVisible();
	await expect.poll(() => serverValue(context.request, rows.ids[0])).toHaveLength(1);
});

const LINKS = process.env.TORSEL_TEST_SOURCES ?? '';

/** Puts a poster, a still and a web page on the fixture server, under a key of this test's own. */
async function servePosters(request: APIRequestContext): Promise<(path: string) => string> {
	const key = randomUUID().slice(0, 8);
	const image = (bytes: Buffer) => ({
		type: 'image/jpeg',
		body: '',
		bytes: bytes.toString('base64')
	});
	const response = await request.post(`${LINKS}/__set?key=${key}`, {
		data: {
			'/dune.jpg': image(POSTER),
			'/still.jpg': image(STILL),
			'/page': { type: 'text/html', body: '<!doctype html><p>not a poster</p>' }
		}
	});
	expect(response.ok()).toBe(true);
	return (path) => `${LINKS}/${key}${path}`;
}

async function pasteText(target: Locator, text: string): Promise<void> {
	await target.evaluate((element, pasted) => {
		const data = new DataTransfer();
		data.setData('text/plain', pasted);
		element.dispatchEvent(
			new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
		);
	}, text);
}

test.describe('image links', () => {
	test('a pasted link is fetched by the server into the cell, and a page is refused', async ({
		page,
		context,
		account
	}) => {
		void account;
		const url = await servePosters(context.request);
		const movies = await seedMovies(context.request);
		await page.goto(movies.grid);
		const catcher = page.locator('textarea[aria-hidden="true"]').first();

		await posterCell(page, 'Alien').click();
		await pasteText(catcher, url('/dune.jpg'));
		await expect(posterCell(page, 'Alien').getByRole('img')).toHaveCount(1);
		await expect(page.getByRole('status')).toContainText('Image added');
		await expectPosterShape(posterCell(page, 'Alien').getByRole('img'), 1.5);
		await expect
			.poll(() => serverValue(context.request, movies.rows[1]))
			.toMatchObject([{ src: url('/dune.jpg'), name: 'dune.jpg', w: 342, h: 513 }]);

		await posterCell(page, 'Dune').click();
		await pasteText(catcher, url('/page'));
		await expect(page.getByRole('status')).toContainText(
			'This link isn’t a JPEG, PNG, WebP, GIF or AVIF image'
		);
		await expect(posterCell(page, 'Dune').getByRole('img')).toHaveCount(0);
	});

	test('the row sheet adds an image from a link', async ({ page, context, account, isMobile }) => {
		void account;
		const url = await servePosters(context.request);
		const movies = await seedMovies(context.request);
		await page.goto(movies.grid);

		await posterCell(page, 'Alien').click();
		await page.keyboard.press('Enter');
		const sheet = page.getByRole('dialog', { name: 'Poster' });
		if (isMobile) {
			await sheet.getByRole('button', { name: 'Add' }).click();
			await page.getByRole('menuitem', { name: 'From a link' }).click();
		} else {
			await sheet.getByRole('button', { name: 'Add from a link' }).click();
		}
		const link = sheet.getByRole('textbox', { name: 'Image link' });
		await expect(link).toBeFocused();
		await link.fill(url('/still.jpg'));
		await link.press('Enter');
		await expect(sheet.getByRole('button', { name: 'still.jpg', exact: true })).toBeVisible();
		await expect(link).toBeHidden();
		await expect
			.poll(() => serverValue(context.request, movies.rows[1]))
			.toMatchObject([{ src: url('/still.jpg') }]);
	});

	test('a column of links becomes images, a link that fails cleared', async ({
		page,
		context,
		account
	}) => {
		void account;
		const url = await servePosters(context.request);
		const table = await seed(context.request, (ws, commit) => {
			const base = createBase(ws, 'Films');
			commit(base.changes);
			const movies = createTable(
				ws,
				base.id,
				'Movies',
				[
					{ name: 'Title', type: 'text' },
					{ name: 'Poster', type: 'url' }
				],
				() => [{ name: names.en.views.grid, type: 'grid', config: {} }]
			);
			commit(movies.changes);
			const [title, poster] = movies.fieldIds;
			commit(
				insertRows(ws, movies.id, [
					{ [title]: 'Dune', [poster]: url('/dune.jpg') },
					{ [title]: 'Alien', [poster]: url('/page') }
				]).changes
			);
			return movies.id;
		});
		await page.goto(tablePath(table));

		await columnMenu(page, 'Poster', 'Field settings');
		const sheet = page.getByRole('dialog', { name: 'Field', exact: true });
		await pick(sheet.getByRole('combobox').first(), 'Image');
		await expect(page.getByRole('status')).toContainText('Poster retyped, 1 value cleared');
		await page.keyboard.press('Escape');

		await expectPosterShape(posterCell(page, 'Dune').getByRole('img'), 1.5);
		await expect(posterCell(page, 'Alien').getByRole('img')).toHaveCount(0);
	});

	test('tall rows show posters larger, and the header keeps its height', async ({
		page,
		context,
		account
	}) => {
		void account;
		const films = createBase(new Workspace(), 'Films');
		const poster = (await upload(context.request, films.id, POSTER)).ref as ImageRef;
		const movies = await seedFor(context.request, films, [{ ...poster, name: 'dune.jpg' }]);
		await page.goto(movies.grid);

		const header = page.getByRole('columnheader', { name: 'Poster', exact: true });
		const thumb = posterCell(page, 'Dune').getByRole('img');
		await expectPosterShape(thumb, 1.5);
		const height = async (target: Locator): Promise<number> =>
			(await target.boundingBox())?.height ?? 0;
		const row = await height(posterCell(page, 'Dune'));
		const head = await height(header);

		await tableMenu(page, 'View settings');
		const settings = page.getByRole('dialog', { name: 'View settings' });
		await pick(settings.getByRole('combobox', { name: 'Row height' }), 'Tall');
		await page.keyboard.press('Escape');
		await expect(settings).toBeHidden();

		await expect.poll(() => height(posterCell(page, 'Dune'))).toBeCloseTo(row * 3, 0);
		expect(await height(header)).toBeCloseTo(head, 0);
		await expectPosterShape(thumb, 1.5);
		expect(await height(thumb)).toBeCloseTo(row * 3 - 8, 0);
	});

	test('the fetch route refuses a link it must never follow', async ({ context, account }) => {
		void account;
		const films = await seedMovies(context.request);
		for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'ftp://example.com/x.jpg']) {
			const response = await context.request.post(`/api/blobs/${films.base}/fetch`, {
				...RETRY_RESET,
				data: { url }
			});
			expect(response.status(), url).toBe(400);
		}
	});
});
