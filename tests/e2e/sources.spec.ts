import { randomUUID } from 'node:crypto';

import type { APIRequestContext, Page } from '@playwright/test';

import type { FakeAnswer, FakeHit } from './fake-sources.ts';
import { askButton, cell, expect, script, tablePath, test, workbook } from './harness.ts';

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
		await askButton(page).click();
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
});
