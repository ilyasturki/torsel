import names from '../../src/lib/i18n/names.ts';
import type { APIRequestContext, Page } from '@playwright/test';

import { createBase, createTable, defaultViews, insertRows } from '../../src/lib/core/actions.ts';
import { expect, script, seed, tablePath, test } from './harness.ts';

const FAKE = process.env.TORSEL_TEST_FAKE ?? '';

const IMDB = { url: 'https://www.imdb.com/title/tt0078748/', title: 'Alien (1979) - IMDb' };
const WIKI = { url: 'https://en.wikipedia.org/wiki/Alien_(film)', title: 'Alien (film)' };

type Seen = {
	requests: { messages: { role: string }[]; body: { tools: { type?: string; name: string }[] } }[];
};

function seedFilms(request: APIRequestContext): Promise<string> {
	return seed(request, (ws, commit) => {
		const base = createBase(ws, 'Cinema');
		commit(base.changes);
		const table = createTable(
			ws,
			base.id,
			'Films',
			[
				{ name: 'Title', type: 'text' },
				{ name: 'IMDb', type: 'number' }
			],
			() => defaultViews(names.en)
		);
		commit(table.changes);
		commit(insertRows(ws, table.id, [{ [table.fieldIds[0]]: 'Dune' }]).changes);
		return table.id;
	});
}

async function ask(page: Page, text: string, label = 'Ask'): Promise<void> {
	const asker = page.locator('#ask-input');
	if (!(await asker.isVisible())) {
		await page.getByRole('button', { name: new RegExp(`^${label}`, 'u') }).click();
	}
	await asker.fill(text);
	await asker.press('Enter');
}

test('a request that needs the web searches it, writes what it found, and names the sites under the reply', async ({
	page,
	context,
	account
}) => {
	void account;
	const key = await script(context.request, [
		{
			blocks: [
				{ type: 'search', id: 'srvtoolu_1', query: 'Alien 1979 IMDb rating' },
				{
					type: 'found',
					id: 'srvtoolu_1',
					results: [IMDB, WIKI, { ...IMDB, url: `${IMDB.url}ratings` }]
				},
				{
					type: 'tool',
					id: 'toolu_add',
					name: 'add_rows',
					input: { base: 'Cinema', table: 'Films', rows: [{ Title: 'Alien', IMDb: 8.5 }] }
				}
			],
			holdAt: 'srvtoolu_1'
		},
		{ blocks: [{ type: 'text', text: 'Done.' }] }
	]);
	const table = await seedFilms(context.request);
	await page.goto(tablePath(table));
	await ask(page, `${key} add Alien with its IMDb rating`);

	await expect(page.getByTestId('step')).toHaveText('Searching the web…');
	await context.request.post(`${FAKE}/__release?key=${key}`);

	const thread = page.getByTestId('thread');
	await expect(thread.getByText('Done.')).toBeVisible();
	await expect(thread.getByTestId('change')).toHaveCount(1);
	const sources = thread.getByTestId('sources');
	await expect(sources.getByRole('link')).toHaveText(['imdb.com', 'en.wikipedia.org']);
	await expect(sources.getByRole('link', { name: 'imdb.com' })).toHaveAttribute('href', IMDB.url);

	const { requests } = (await (
		await context.request.get(`${FAKE}/__seen?key=${key}`)
	).json()) as Seen;
	expect(requests[0].body.tools.find((tool) => tool.name === 'web_search')).toMatchObject({
		type: 'web_search_20260209',
		max_uses: 10
	});

	await page.reload();
	if (!(await page.locator('#ask-input').isVisible())) {
		await page.getByRole('button', { name: /^Ask/u }).click();
	}
	await expect(page.getByTestId('thread').getByTestId('sources').getByRole('link')).toHaveText([
		'imdb.com',
		'en.wikipedia.org'
	]);
});

test('a search the server paused goes on in the next request, and a cited answer reads as one', async ({
	page,
	context,
	account
}) => {
	void account;
	const key = await script(context.request, [
		{
			blocks: [{ type: 'search', id: 'srvtoolu_1', query: 'Dune IMDb rating' }],
			stop: 'pause_turn'
		},
		{
			blocks: [
				{ type: 'found', id: 'srvtoolu_1', results: [IMDB] },
				{ type: 'text', text: 'Rated ' },
				{ type: 'text', text: '8.5', cites: [{ ...IMDB, cited: '8.5/10' }] },
				{ type: 'text', text: ' on IMDb.' }
			]
		}
	]);
	const table = await seedFilms(context.request);
	await page.goto(tablePath(table));
	await ask(page, `${key} what is Dune rated`);

	const thread = page.getByTestId('thread');
	await expect(thread.getByText('Rated 8.5 on IMDb.')).toBeVisible();
	await expect(thread.getByTestId('sources').getByRole('link')).toHaveText(['imdb.com']);

	const { requests } = (await (
		await context.request.get(`${FAKE}/__seen?key=${key}`)
	).json()) as Seen;
	expect(requests).toHaveLength(2);
	expect(requests[1].messages.at(-1)?.role).toBe('assistant');
});

test('a search stopped while paused leaves nothing half done in the next request', async ({
	page,
	context,
	account
}) => {
	void account;
	const key = await script(context.request, [
		{ blocks: [{ type: 'search', id: 'srvtoolu_1', query: 'Dune' }], stop: 'pause_turn' },
		{
			blocks: [
				{ type: 'found', id: 'srvtoolu_1', results: [IMDB] },
				{ type: 'text', text: 'Rated' }
			],
			holdAfter: 'Rated'
		},
		{ blocks: [{ type: 'text', text: 'Fine.' }] }
	]);
	const table = await seedFilms(context.request);
	await page.goto(tablePath(table));
	await ask(page, `${key} what is Dune rated`);
	await expect.poll(async () => (await seen()).requests.length).toBe(2);
	await page.getByRole('button', { name: 'Stop' }).click();
	await expect(page.getByTestId('thread').getByText('Stopped.')).toBeVisible();

	await ask(page, 'and Alien?');
	await expect(page.getByTestId('thread').getByText('Fine.')).toBeVisible();
	const { requests } = await seen();
	const blocks = JSON.stringify(requests[2].messages);
	expect(blocks).not.toContain('server_tool_use');

	async function seen(): Promise<Seen> {
		return (await context.request.get(`${FAKE}/__seen?key=${key}`)).json();
	}
});

test.describe('fr-FR', () => {
	test.use({ locale: 'fr-FR' });

	test('the step line says it searches the web', async ({ page, context, account }) => {
		void account;
		const key = await script(context.request, [
			{
				blocks: [{ type: 'search', id: 'srvtoolu_1', query: 'Dune' }],
				holdAt: 'srvtoolu_1',
				stop: 'pause_turn'
			},
			{
				blocks: [
					{ type: 'found', id: 'srvtoolu_1', results: [IMDB] },
					{ type: 'text', text: '8,5.' }
				]
			}
		]);
		const table = await seedFilms(context.request);
		await page.goto(tablePath(table));
		await ask(page, `${key} note de Dune`, 'Demander');
		await expect(page.getByTestId('step')).toHaveText('Recherche sur le web…');
		await context.request.post(`${FAKE}/__release?key=${key}`);
		await expect(page.getByTestId('thread').getByText('8,5.')).toBeVisible();
	});
});
