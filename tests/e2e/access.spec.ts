import names from '../../src/lib/i18n/names.ts';

import type { APIRequestContext, Locator, Page } from '@playwright/test';

import { createBase, createTable, defaultViews, insertRows } from '../../src/lib/core/actions.ts';
import {
	askButton,
	cell,
	expect,
	script,
	seed,
	syncFromSource,
	tablePath,
	test
} from './harness.ts';

const FAKE = process.env.TORSEL_TEST_FAKE ?? '';

/** Movies, with one row, Alien rated 4; Title and Rating will come from a source, Notes stays the person's. */
function seedMovies(request: APIRequestContext) {
	return seed(request, (ws, commit) => {
		const base = createBase(ws, 'Films');
		commit(base.changes);
		const movies = createTable(
			ws,
			base.id,
			'Movies',
			[
				{ name: 'Title', type: 'text' },
				{ name: 'Rating', type: 'number' },
				{ name: 'Notes', type: 'text' }
			],
			() => defaultViews(names.en)
		);
		commit(movies.changes);
		const [title, rating] = movies.fieldIds;
		const rows = insertRows(ws, movies.id, [{ [title]: 'Alien', [rating]: 4 }]);
		commit(rows.changes);
		return { table: movies.id, entry: movies.viewIds[1], row: rows.ids[0] };
	});
}

/** The Notes cell of the first row: empty, so it has no name to find it by. */
const notesCell = (page: Page) => page.locator('td[data-r="0"][data-c="2"]');

/** Asks for a cell's editor as each screen does: a double click, or a tap on a phone. */
async function openEditor(target: Locator, isMobile: boolean): Promise<void> {
	if (isMobile) await target.tap();
	else await target.dblclick();
}

async function typeInto(page: Page, target: Locator, text: string, isMobile: boolean) {
	await openEditor(target, isMobile);
	const editor = page.getByRole('gridcell').getByRole('textbox');
	await editor.fill(text);
	await editor.press('Enter');
}

test('a synced field takes no edit in the grid, and the table no new or deleted row', async ({
	page,
	context,
	account,
	isMobile
}) => {
	const movies = await seedMovies(context.request);
	syncFromSource(account, 'Movies', ['Title', 'Rating']);
	await page.goto(tablePath(movies.table));

	const title = cell(page, 'Alien');
	await expect(title).toHaveAttribute('aria-readonly', 'true');
	await expect(
		page.getByRole('columnheader', { name: 'Title', exact: true }).locator('svg')
	).toBeVisible();
	await expect(notesCell(page)).not.toHaveAttribute('aria-readonly', 'true');

	await openEditor(title, isMobile);
	await expect(page.getByRole('gridcell').getByRole('textbox')).toHaveCount(0);
	if (!isMobile) {
		await page.keyboard.type('Aliens');
		await page.keyboard.press('Enter');
		await page.keyboard.press('Delete');
		await expect(page.getByRole('gridcell').getByRole('textbox')).toHaveCount(0);
	}
	await expect(title).toBeVisible();
	await expect(cell(page, '4')).toBeVisible();

	await expect(page.getByRole('button', { name: 'Add row' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'New row' })).toHaveCount(0);

	if (!isMobile) {
		await title.click({ button: 'right' });
		await expect(page.getByRole('menuitem', { name: /Copy/u })).toBeVisible();
		await expect(page.getByRole('menuitem', { name: /Delete/u })).toHaveCount(0);
		await expect(page.getByRole('menuitem', { name: /Insert/u })).toHaveCount(0);
		await page.keyboard.press('Escape');
	}

	await typeInto(page, notesCell(page), 'seen twice', isMobile);
	await expect(cell(page, 'seen twice')).toBeVisible();
});

test('the row sheet shows synced values with no input, and keeps the rest editable', async ({
	page,
	context,
	account
}) => {
	const movies = await seedMovies(context.request);
	syncFromSource(account, 'Movies', ['Title', 'Rating']);
	await page.goto(tablePath(movies.table));

	await page.getByRole('button', { name: 'Open row' }).first().click();
	const sheet = page.getByRole('dialog');
	await expect(sheet.locator('[aria-readonly="true"]').filter({ hasText: 'Alien' })).toBeVisible();
	await expect(sheet.getByRole('textbox', { name: 'Title' })).toHaveCount(0);
	await expect(sheet.getByRole('textbox', { name: 'Rating' })).toHaveCount(0);
	await expect(sheet.getByRole('button', { name: 'More' })).toHaveCount(0);

	await sheet.getByRole('textbox', { name: 'Notes' }).fill('seen twice');
	await page.keyboard.press('Escape');
	await expect(cell(page, 'seen twice')).toBeVisible();
	await expect(cell(page, 'Alien')).toBeVisible();
});

test('Entry on a synced table logs nothing, and its rows open read-only', async ({
	page,
	context,
	account
}) => {
	const movies = await seedMovies(context.request);
	syncFromSource(account, 'Movies', ['Title', 'Rating']);
	await page.goto(tablePath(movies.table, movies.entry));

	const row = page.getByRole('button', { name: /Alien/u });
	await expect(row).toBeVisible();
	await expect(page.getByRole('button', { name: 'Add row' })).toHaveCount(0);
	await expect(page.getByRole('textbox')).toHaveCount(0);

	await row.click();
	const sheet = page.getByRole('dialog');
	await expect(sheet.getByRole('textbox', { name: 'Title' })).toHaveCount(0);
	await expect(sheet.getByRole('textbox', { name: 'Notes' })).toBeVisible();
});

test('an offline edit of a field that became synced comes back after sync, with one toast', async ({
	page,
	context,
	account,
	isMobile
}) => {
	const movies = await seedMovies(context.request);
	await page.goto(tablePath(movies.table));
	await expect(cell(page, 'Alien')).toBeVisible();

	await context.setOffline(true);
	await typeInto(page, cell(page, 'Alien'), 'Aliens', isMobile);
	await expect(cell(page, 'Aliens')).toBeVisible();

	syncFromSource(account, 'Movies', ['Title', 'Rating']);
	await context.setOffline(false);

	await expect(cell(page, 'Alien')).toBeVisible();
	await expect(cell(page, 'Alien')).toHaveAttribute('aria-readonly', 'true');
	const toast = page.getByRole('status').filter({ hasText: 'Couldn’t change synced data' });
	await expect(toast).toHaveCount(1);
});

test.describe('agents', () => {
	test.skip(({ isMobile }) => isMobile, 'the refusal is the same whatever the screen');

	async function rpc(request: APIRequestContext, token: string, name: string, args: unknown) {
		const answer = await request.post('/api/mcp', {
			headers: { authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream' },
			data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }
		});
		const body = await answer.text();
		const json = body.startsWith('{') ? body : (/^data: (.*)$/mu.exec(body)?.[1] ?? '');
		return (JSON.parse(json) as { result: { isError?: boolean; content: { text: string }[] } })
			.result;
	}

	test('MCP refuses synced values and rows, and says where to go instead', async ({
		context,
		account
	}) => {
		const movies = await seedMovies(context.request);
		syncFromSource(account, 'Movies', ['Title', 'Rating']);
		const minted = await context.request.post('/api/auth/tokens', { data: { label: 'e2e' } });
		const { token } = (await minted.json()) as { token: string };

		const changed = await rpc(context.request, token, 'update_rows', {
			base: 'Films',
			table: 'Movies',
			updates: [{ id: movies.row, values: { Title: 'Aliens' } }]
		});
		expect(changed).toMatchObject({
			isError: true,
			content: [
				{ text: expect.stringContaining('"Movies" gets "Title", "Rating" from its source') }
			]
		});
		const added = await rpc(context.request, token, 'add_rows', {
			base: 'Films',
			table: 'Movies',
			rows: [{ Notes: 'mine' }]
		});
		expect(added).toMatchObject({
			isError: true,
			content: [{ text: expect.stringContaining('gets its rows from its source') }]
		});

		const notes = await rpc(context.request, token, 'update_rows', {
			base: 'Films',
			table: 'Movies',
			updates: [{ id: movies.row, values: { Notes: 'seen twice' } }]
		});
		expect(notes.isError).toBeFalsy();
	});

	test('the assistant hears the refusal and writes nothing', async ({ page, context, account }) => {
		const movies = await seedMovies(context.request);
		syncFromSource(account, 'Movies', ['Title', 'Rating']);
		const key = await script(context.request, [
			{
				blocks: [
					{
						type: 'tool',
						id: 'toolu_rename',
						name: 'update_rows',
						input: {
							base: 'Films',
							table: 'Movies',
							updates: [{ id: movies.row, values: { Title: 'Aliens' } }]
						}
					}
				]
			},
			{ blocks: [{ type: 'text', text: 'Title comes from the source.' }] }
		]);
		await page.goto(tablePath(movies.table));
		await askButton(page).click();
		await page.getByPlaceholder('Ask about your tables').fill(`${key} rename Alien`);
		await page.getByRole('button', { name: 'Send' }).click();
		await expect(
			page.getByTestId('thread').getByText('Title comes from the source.')
		).toBeVisible();

		const seen = (await (await context.request.get(`${FAKE}/__seen?key=${key}`)).json()) as {
			requests: { messages: unknown[] }[];
		};
		expect(JSON.stringify(seen.requests[1]?.messages.at(-1))).toContain(
			'gets \\"Title\\", \\"Rating\\" from its source'
		);
		await expect(cell(page, 'Alien')).toBeVisible();
	});
});
