import { randomUUID } from 'node:crypto';

import type { APIRequestContext, Locator, Page } from '@playwright/test';

import type { Rec } from '../../src/lib/core/model.ts';

import type { FakeAnswer, FakeHit } from './fake-sources.ts';
import {
	cell,
	expect,
	expectListed,
	openAsk,
	script,
	tablePath,
	test,
	toastButton,
	workbook
} from './harness.ts';

const LINKS = process.env.TORSEL_TEST_SOURCES ?? '';

const MOVIES = 'id,Title,Rating\n1,Alien,4\n2,Heat,5\n';

type Links = { url(path: string): string; hits(): Promise<FakeHit[]> };

/** Puts links on the fixture server, under a key of this test's own. */
async function serve(
	request: APIRequestContext,
	answers: Record<string, FakeAnswer>
): Promise<Links & { set(more: Record<string, FakeAnswer>): Promise<void> }> {
	const key = randomUUID().slice(0, 8);
	const set = async (more: Record<string, FakeAnswer>): Promise<void> => {
		const response = await request.post(`${LINKS}/__set?key=${key}`, { data: more });
		expect(response.ok()).toBe(true);
	};
	await set(answers);
	return {
		url: (path) => `${LINKS}/${key}${path}`,
		hits: async () => (await (await request.get(`${LINKS}/__hits?key=${key}`)).json()) as FakeHit[],
		set
	};
}

type Made = { table: string; outcome: { ok: boolean; added?: number; problem?: string | null } };

/** What the import sheet does with a link: preview it, then make the table from what it suggests. */
async function link(
	request: APIRequestContext,
	url: string,
	extra: Record<string, unknown> = {}
): Promise<Made> {
	const previewed = await request.post('/api/sources/preview', { data: { url, ...extra } });
	expect(previewed.status(), await previewed.text()).toBe(200);
	const preview = (await previewed.json()) as {
		columns: unknown[];
		rows: string;
		suggested: Record<string, unknown>;
	};
	const { auth: _, ...suggested } = preview.suggested;
	const made = await request.post('/api/sources', {
		data: { ...suggested, url, rows: preview.rows || null, columns: preview.columns, ...extra }
	});
	expect(made.status(), await made.text()).toBe(201);
	return (await made.json()) as Made;
}

async function openTable(page: Page, table: string): Promise<void> {
	await page.goto(tablePath(table));
	await expect(page.getByRole('grid')).toBeVisible();
}

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Diary</title>
<item><guid>w-2</guid><title>Heat</title><pubDate>Tue, 10 Nov 2026 10:00:00 +0000</pubDate></item>
<item><guid>w-1</guid><title>Alien</title><pubDate>Mon, 09 Nov 2026 10:00:00 +0000</pubDate></item>
</channel></rss>`;

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Releases</title>
<entry><id>tag:v2</id><title>v2.0</title><link rel="alternate" href="https://example.com/v2"/></entry>
<entry><id>tag:v1</id><title>v1.0</title><link rel="alternate" href="https://example.com/v1"/></entry>
</feed>`;

test.describe('tables from a link', () => {
	test('reads each format into a table', async ({ page, context, account, isMobile }) => {
		test.skip(isMobile, 'the server reads the link: one viewport says it');
		void account;
		const book = workbook(
			'<row r="1"><c r="A1" t="inlineStr"><is><t>Day</t></is></c><c r="B1" t="inlineStr"><is><t>Kg</t></is></c></row>' +
				'<row r="2"><c r="A2" t="inlineStr"><is><t>2026-11-14</t></is></c><c r="B2"><v>81.5</v></c></row>'
		);
		const links = await serve(context.request, {
			'/movies.csv': { body: MOVIES },
			'/movies.tsv': { type: 'text/tab-separated-values', body: 'id\tTitle\n1\tAlien\n' },
			'/movies.json': {
				type: 'application/json',
				body: JSON.stringify({
					data: { results: [{ id: 1, title: 'Alien', meta: { year: 1979 } }] }
				})
			},
			'/weigh-ins.xlsx': {
				type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
				body: '',
				bytes: book.toString('base64')
			},
			'/diary.rss': { type: 'application/rss+xml', body: RSS },
			'/releases.atom': { type: 'application/atom+xml', body: ATOM }
		});

		const csv = await link(context.request, links.url('/movies.csv'));
		expect(csv.outcome).toMatchObject({ ok: true, added: 2 });
		expect((await link(context.request, links.url('/movies.tsv'))).outcome).toMatchObject({
			added: 1
		});
		const json = await link(context.request, links.url('/movies.json'));
		expect(json.outcome).toMatchObject({ added: 1 });
		expect((await link(context.request, links.url('/weigh-ins.xlsx'))).outcome).toMatchObject({
			added: 1
		});
		const rss = await link(context.request, links.url('/diary.rss'));
		expect(rss.outcome).toMatchObject({ added: 2 });
		expect((await link(context.request, links.url('/releases.atom'))).outcome).toMatchObject({
			added: 2
		});

		await openTable(page, csv.table);
		await expect(cell(page, 'Alien')).toHaveAttribute('aria-readonly', 'true');
		await expect(cell(page, 'Heat')).toBeVisible();
		await openTable(page, json.table);
		await expect(page.getByRole('columnheader', { name: 'Year', exact: true })).toBeVisible();
		await expect(cell(page, '1979')).toBeVisible();
		await openTable(page, rss.table);
		await expect(cell(page, 'Alien')).toBeVisible();
	});

	test('signs with each kind of key, and says when one is missing', async ({
		context,
		account,
		isMobile
	}) => {
		test.skip(isMobile, 'the server reads the link: one viewport says it');
		void account;
		const links = await serve(context.request, {
			'/bearer.csv': { body: MOVIES, need: { header: 'authorization', value: 'Bearer tok-1' } },
			'/basic.csv': {
				body: MOVIES,
				need: { header: 'authorization', value: `Basic ${Buffer.from('me:pw').toString('base64')}` }
			},
			'/header.csv': { body: MOVIES, need: { header: 'x-api-key', value: 'hk-1' } },
			'/query.csv': { body: MOVIES, need: { query: 'api_key', value: 'qk-1' } }
		});

		const refused = await context.request.post('/api/sources/preview', {
			data: { url: links.url('/bearer.csv') }
		});
		expect(refused.status()).toBe(422);
		expect(await refused.json()).toMatchObject({ problem: 'auth', message: 'Key refused' });

		for (const [path, auth, secret] of [
			['/bearer.csv', { kind: 'bearer', name: null }, 'tok-1'],
			['/basic.csv', { kind: 'basic', name: null }, 'me:pw'],
			['/header.csv', { kind: 'header', name: 'X-Api-Key' }, 'hk-1'],
			['/query.csv', { kind: 'query', name: 'api_key' }, 'qk-1']
		] as const) {
			const made = await link(context.request, links.url(path), { auth, secret });
			expect(made.outcome, path).toMatchObject({ ok: true, added: 2 });
			const source = await (await context.request.get(`/api/sources/${made.table}`)).json();
			expect(JSON.stringify(source)).not.toContain(secret);
			expect(source).toMatchObject({ auth: auth.kind, hasKey: true });
		}
	});

	test('follows pages by Link header and by the next link in the answer', async ({
		context,
		account,
		isMobile
	}) => {
		test.skip(isMobile, 'the server reads the link: one viewport says it');
		void account;
		const links = await serve(context.request, {});
		await links.set({
			'/issues': {
				type: 'application/json',
				body: JSON.stringify([{ id: 1, title: 'one' }]),
				headers: { link: `<${links.url('/issues2')}>; rel="next"` }
			},
			'/issues2': { type: 'application/json', body: JSON.stringify([{ id: 2, title: 'two' }]) },
			'/feed': {
				type: 'application/json',
				body: JSON.stringify({ items: [{ id: 'a' }], next: links.url('/feed2') })
			},
			'/feed2': {
				type: 'application/json',
				body: JSON.stringify({ items: [{ id: 'b' }], next: null })
			}
		});

		expect((await link(context.request, links.url('/issues'))).outcome).toMatchObject({ added: 2 });
		expect((await link(context.request, links.url('/feed'))).outcome).toMatchObject({ added: 2 });
	});

	test('refreshes: a changed value arrives, a failure keeps the rows, a row gone goes', async ({
		page,
		context,
		account
	}) => {
		void account;
		const links = await serve(context.request, { '/movies.csv': { body: MOVIES } });
		const made = await link(context.request, links.url('/movies.csv'));
		await openTable(page, made.table);
		await expect(cell(page, '4')).toBeVisible();

		await links.set({ '/movies.csv': { body: 'id,Title,Rating\n1,Alien,3\n2,Heat,5\n' } });
		const refreshed = await context.request.post(`/api/sources/${made.table}/refresh`, {
			data: {}
		});
		expect((await refreshed.json()).outcome).toMatchObject({ ok: true, changed: 1 });
		await page.reload();
		await expect(cell(page, '3')).toBeVisible();

		await links.set({ '/movies.csv': { status: 500, body: '' } });
		const failed = await context.request.post(`/api/sources/${made.table}/refresh`, { data: {} });
		expect((await failed.json()).outcome).toEqual({ ok: false, problem: 'status' });
		await page.reload();
		await expect(cell(page, 'Heat')).toBeVisible();

		await links.set({ '/movies.csv': { body: 'id,Title,Rating\n1,Alien,3\n' } });
		await context.request.post(`/api/sources/${made.table}/refresh`, { data: {} });
		await page.reload();
		await expect(cell(page, 'Alien')).toBeVisible();
		await expect(cell(page, 'Heat')).toHaveCount(0);
	});

	test('keeps synced fields read-only until syncing stops', async ({ page, context, account }) => {
		void account;
		const links = await serve(context.request, { '/movies.csv': { body: MOVIES } });
		const made = await link(context.request, links.url('/movies.csv'));
		await openTable(page, made.table);
		await expect(cell(page, 'Alien')).toHaveAttribute('aria-readonly', 'true');
		await expect(page.getByRole('button', { name: 'New row' })).toHaveCount(0);

		const stopped = await context.request.delete(`/api/sources/${made.table}`, { data: {} });
		expect(stopped.status()).toBe(204);
		await page.reload();
		await expect(cell(page, 'Alien')).not.toHaveAttribute('aria-readonly', 'true');
		await expect(cell(page, 'Heat')).toBeVisible();
	});

	test('the assistant links a table and the key goes in its card', async ({
		page,
		context,
		account
	}) => {
		void account;
		const links = await serve(context.request, {
			'/private.csv': { body: MOVIES, need: { header: 'authorization', value: 'Bearer tok-9' } }
		});
		const key = await script(context.request, [
			{
				blocks: [
					{
						type: 'tool',
						id: 'toolu_link',
						name: 'connect_source',
						input: {
							url: links.url('/private.csv'),
							name: 'Watched',
							auth: { kind: 'bearer' },
							key: 'id',
							fields: [
								{ from: 'Title', name: 'Title', type: 'text' },
								{ from: 'Rating', name: 'Rating', type: 'number' }
							]
						}
					}
				]
			},
			{ blocks: [{ type: 'text', text: 'Linked.' }] }
		]);
		await page.goto('/app');
		await openAsk(page);
		await page.getByPlaceholder('Ask about your tables').fill(`${key} link my private list`);
		await page.getByRole('button', { name: 'Send' }).click();
		await expect(page.getByTestId('thread').getByText('Linked.')).toBeVisible();

		const card = page.getByTestId('change');
		await expect(card).toContainText('"Watched" linked to 127.0.0.1');
		const field = card.getByRole('textbox', { name: 'Key' }).or(card.getByLabel('Key'));
		await field.fill('tok-9');
		await card.getByRole('button', { name: 'Connect' }).click();
		await expect(card.getByLabel('Key')).toHaveCount(0);
		expect((await links.hits()).at(-1)?.authorization).toBe('Bearer tok-9');

		await card.getByRole('link', { name: 'Show' }).click();
		await expect(cell(page, 'Alien')).toBeVisible();
		await expect(cell(page, 'Alien')).toHaveAttribute('aria-readonly', 'true');
	});

	test('the card undoes a linked table, which stops its runs, and redoes it', async ({
		page,
		context,
		account
	}) => {
		void account;
		const links = await serve(context.request, { '/movies.csv': { body: MOVIES } });
		const key = await script(context.request, [
			{
				blocks: [
					{
						type: 'tool',
						id: 'toolu_public',
						name: 'connect_source',
						input: { url: links.url('/movies.csv'), name: 'Watched' }
					}
				]
			},
			{ blocks: [{ type: 'text', text: 'Linked.' }] }
		]);
		await page.goto('/app');
		await openAsk(page);
		await page.getByPlaceholder('Ask about your tables').fill(`${key} link the public list`);
		await page.getByRole('button', { name: 'Send' }).click();
		await expect(page.getByTestId('thread').getByText('Linked.')).toBeVisible();
		const card = page.getByTestId('change');
		await expect(card.getByRole('link', { name: 'Show' })).toBeVisible();
		const stored = async (): Promise<Rec | undefined> => {
			const pulled = await context.request.post('/api/sync', { data: { watermark: 0, push: [] } });
			const { records } = (await pulled.json()) as { records: Rec[] };
			return records.find((rec) => rec.kind === 'table' && rec.data.name === 'Watched');
		};
		const table = (await stored())?.id ?? '';

		const refresh = async (): Promise<unknown> =>
			(await (await context.request.post(`/api/sources/${table}/refresh`, { data: {} })).json())
				.outcome;
		// Whether the server holds the table deleted, once the device has pushed its step.
		const deleted = async (): Promise<boolean> => (await stored())?.data._del === true;

		await card.getByRole('button', { name: 'Undo' }).click();
		await expect(card).toHaveAttribute('data-status', 'undone');
		await expect.poll(deleted).toBe(true);
		expect(await refresh()).toEqual({ ok: false, problem: 'gone' });

		await card.getByRole('button', { name: 'Redo' }).click();
		await expect(card).toHaveAttribute('data-status', 'applied');
		await expect.poll(deleted).toBe(false);
		expect(await refresh()).toMatchObject({ ok: true });
		await card.getByRole('link', { name: 'Show' }).click();
		await expect(cell(page, 'Alien')).toHaveAttribute('aria-readonly', 'true');
		await expect(page.getByRole('columnheader', { name: 'Title', exact: true })).toBeVisible();
	});
});

test.describe('importing from a link', () => {
	async function openImport(page: Page): Promise<Locator> {
		await page.goto('/app');
		await page.getByRole('button', { name: 'Import', exact: true }).click();
		return page.getByRole('dialog');
	}

	test('reads a link into a preview, drops a column and makes a synced table', async ({
		page,
		context,
		account
	}) => {
		void account;
		const links = await serve(context.request, { '/movies.csv': { body: MOVIES } });
		const sheet = await openImport(page);
		await sheet.getByLabel('File or link').fill(links.url('/movies.csv'));
		await sheet.getByRole('button', { name: 'Continue' }).click();

		await expect(sheet.getByText('CSV · 2 rows')).toBeVisible();
		await expect(sheet.getByRole('cell', { name: 'Heat' })).toBeVisible();
		await sheet.getByRole('checkbox', { name: 'Rating' }).uncheck();
		await sheet.getByLabel('Table name').fill('Watched');
		await expect(sheet.getByRole('checkbox', { name: 'Keep in sync' })).toBeChecked();
		await sheet.getByRole('button', { name: 'Create' }).click();

		await expect(page.getByRole('heading', { name: 'Watched' })).toBeVisible();
		await expect(cell(page, 'Alien')).toHaveAttribute('aria-readonly', 'true');
		await expect(page.getByRole('columnheader', { name: 'Rating', exact: true })).toHaveCount(0);
		await expect(page.getByRole('status')).toContainText('2 rows imported into "Watched"');
		await toastButton(page, 'Undo').click();
		await expectListed(page, 'Watched', 0);
	});

	test('asks for a key when the link refuses, then reads it', async ({
		page,
		context,
		account
	}) => {
		void account;
		const links = await serve(context.request, {
			'/private.csv': { body: MOVIES, need: { header: 'authorization', value: 'Bearer tok-7' } }
		});
		const sheet = await openImport(page);
		await sheet.getByLabel('File or link').fill(links.url('/private.csv'));
		await sheet.getByRole('button', { name: 'Continue' }).click();

		await expect(sheet.getByText('Key needed')).toBeVisible();
		await expect(sheet.getByRole('button', { name: 'Continue' })).toBeDisabled();
		await sheet.getByLabel('Key').fill('tok-7');
		await sheet.getByRole('button', { name: 'Retry' }).click();
		await expect(sheet.getByText('CSV · 2 rows')).toBeVisible();
		await sheet.getByRole('button', { name: 'Create' }).click();

		await expect(cell(page, 'Alien')).toBeVisible();
		expect((await links.hits()).at(-1)?.authorization).toBe('Bearer tok-7');
	});

	test('a one-time import leaves the table the person’s own', async ({
		page,
		context,
		account
	}) => {
		void account;
		const links = await serve(context.request, { '/movies.csv': { body: MOVIES } });
		const sheet = await openImport(page);
		await sheet.getByLabel('File or link').fill(links.url('/movies.csv'));
		await sheet.getByRole('button', { name: 'Continue' }).click();
		await sheet.getByRole('checkbox', { name: 'Keep in sync' }).uncheck();
		await expect(sheet.getByRole('button', { name: 'Hourly' })).toHaveCount(0);
		await sheet.getByRole('button', { name: 'Create' }).click();

		await expect(cell(page, 'Alien')).toBeVisible();
		await expect(cell(page, 'Alien')).not.toHaveAttribute('aria-readonly', 'true');
	});
});

test.describe('a synced table’s glyph', () => {
	async function openSource(page: Page): Promise<Locator> {
		await page.getByRole('button', { name: 'Source', exact: true }).click();
		const panel = page.getByTestId('source');
		await expect(panel.getByRole('button', { name: 'Refresh' })).toBeVisible();
		return panel;
	}

	test('opens the source: schedule, refresh, a new link, then stop syncing', async ({
		page,
		context,
		account,
		isMobile
	}) => {
		void account;
		const links = await serve(context.request, {
			'/movies.csv': { body: MOVIES },
			'/more.csv': { body: 'id,Title,Rating\n3,Ran,5\n' }
		});
		const made = await link(context.request, links.url('/movies.csv'));
		await openTable(page, made.table);

		const glyph = page.getByRole('button', { name: 'Source', exact: true });
		if (!isMobile) {
			await glyph.hover();
			await expect(page.getByRole('tooltip')).toContainText('Refreshed');
		}
		const panel = await openSource(page);
		await panel.getByRole('button', { name: 'Daily' }).click();
		await expect
			.poll(
				async () => (await (await context.request.get(`/api/sources/${made.table}`)).json()).every
			)
			.toBe('day');

		await panel.getByRole('button', { name: 'Edit link' }).click();
		await panel.getByLabel('Link').fill(links.url('/more.csv'));
		await panel.getByRole('button', { name: 'Save' }).click();
		await expect(cell(page, 'Ran')).toBeVisible();
		await expect(cell(page, 'Alien')).toHaveCount(0);

		await panel.getByRole('button', { name: 'Stop syncing' }).click();
		await panel.getByRole('button', { name: 'Stop syncing for good' }).click();
		await expect(glyph).toHaveCount(0);
		await expect(cell(page, 'Ran')).not.toHaveAttribute('aria-readonly', 'true');
	});

	test('turns amber on a lasting problem, and takes a key that ends it', async ({
		page,
		context,
		account,
		isMobile
	}) => {
		void account;
		const links = await serve(context.request, {
			'/private.csv': { body: MOVIES, need: { header: 'authorization', value: 'Bearer good' } }
		});
		const made = await link(context.request, links.url('/private.csv'), {
			auth: { kind: 'bearer', name: null },
			secret: 'good'
		});
		await links.set({
			'/private.csv': { body: MOVIES, need: { header: 'authorization', value: 'Bearer rotated' } }
		});
		const refreshed = await context.request.post(`/api/sources/${made.table}/refresh`, {
			data: {}
		});
		expect((await refreshed.json()).outcome).toEqual({ ok: false, problem: 'auth' });

		await openTable(page, made.table);
		const glyph = page.getByRole('button', { name: 'Source', exact: true });
		await expect(glyph).toHaveClass(/text-warn/u);
		if (!isMobile) {
			await glyph.hover();
			await expect(page.getByRole('tooltip')).toContainText('Key refused');
		}
		const panel = await openSource(page);
		await expect(panel.getByRole('alert')).toContainText('Key refused');
		await panel.getByLabel('Key').fill('rotated');
		await panel.getByRole('button', { name: 'Save' }).click();
		await expect(panel.getByRole('alert')).toHaveCount(0);
		await expect(glyph).not.toHaveClass(/text-warn/u);
		expect((await links.hits()).at(-1)?.authorization).toBe('Bearer rotated');
	});
});

test.describe('in fr-FR', () => {
	test.use({ locale: 'fr-FR' });

	test('imports a link and shows its source in French', async ({ page, context, account }) => {
		void account;
		const links = await serve(context.request, { '/movies.csv': { body: MOVIES } });
		await page.goto('/app');
		await page.getByRole('button', { name: 'Importer', exact: true }).click();
		const sheet = page.getByRole('dialog');
		await sheet.getByLabel('Fichier ou lien').fill(links.url('/movies.csv'));
		await sheet.getByRole('button', { name: 'Continuer' }).click();

		await expect(sheet.getByText('CSV · 2 lignes')).toBeVisible();
		await expect(sheet.getByRole('checkbox', { name: 'Synchroniser' })).toBeChecked();
		await sheet.getByLabel('Nom de la table').fill('Vus');
		await sheet.getByRole('button', { name: 'Créer' }).click();
		await expect(page.getByRole('status')).toContainText(/2 lignes importées dans «\sVus\s»/u);

		await page.getByRole('button', { name: 'Source', exact: true }).click();
		const panel = page.getByTestId('source');
		await expect(panel.getByRole('button', { name: 'Actualiser' })).toBeVisible();
		await expect(panel.getByText('Absent de la source')).toBeVisible();
		await expect(panel.getByRole('button', { name: 'Chaque heure' })).toBeVisible();
	});
});
