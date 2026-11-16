import names from '#lib/i18n/names.ts';
import { describe, expect, it, vi } from 'vitest';

import { createBase, createTable, defaultViews } from '../../core/actions.ts';
import { createUser } from '../auth/accounts.ts';
import { createDatabase } from '../db/client.ts';
import { runMigrations } from '../db/migrate.ts';
import { loadWorkspace, writeChanges } from '../db/records.ts';
import { toItems } from '../../core/thread.ts';
import type { McpCaller } from './mcp.ts';
import { serveMcp } from './mcp.ts';
import { listThreads, readActions, readRows } from './threads.ts';

type Database = ReturnType<typeof createDatabase>;

async function account(): Promise<{ db: Database; userId: string; caller: McpCaller }> {
	const db = createDatabase(':memory:');
	runMigrations(db);
	const user = await createUser(db, 'me@example.com', 'correct horse');

	const ws = loadWorkspace(db, user.id);
	const base = createBase(ws, 'Films');
	writeChanges(db, { user: user.id, path: 'mcp' }, ws, base.changes);
	const table = createTable(
		ws,
		base.id,
		'Movies',
		[
			{ name: 'Title', type: 'text' },
			{ name: 'Genre', type: 'choice' }
		],
		() => defaultViews(names.en)
	);
	writeChanges(db, { user: user.id, path: 'mcp' }, ws, table.changes);

	return {
		db,
		userId: user.id,
		caller: { userId: user.id, tokenId: 'test', label: 'Test', access: 'write' }
	};
}

const titleOf = (ws: ReturnType<typeof loadWorkspace>, table: string): string =>
	ws.fields(table).find((field) => field.name === 'Title')?.id ?? '';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function rpc(method: string, params: unknown): Request {
	return new Request('http://torsel.test/api/mcp', {
		method: 'POST',
		headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
	});
}

// A 2025-era answer comes as one SSE event or as JSON.
async function message(response: Response): Promise<{ result?: unknown; error?: unknown }> {
	const body = await response.text();
	return JSON.parse(body.startsWith('{') ? body : (/^data: (.*)$/mu.exec(body)?.[1] ?? ''));
}

// The body arrives after `delay`, as from a slow network.
function call(name: string, args: unknown, delay = 0): Request {
	const body = new TextEncoder().encode(
		JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			method: 'tools/call',
			params: { name, arguments: args }
		})
	);
	return new Request('http://torsel.test/api/mcp', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			accept: 'application/json, text/event-stream'
		},
		body: new ReadableStream({
			async pull(controller) {
				await pause(delay);
				controller.enqueue(body);
				controller.close();
			}
		}),
		duplex: 'half'
	} as RequestInit);
}

async function result(response: Response): Promise<{ isError?: boolean; text: string }> {
	const { result: answer } = (await message(response)) as {
		result: { isError?: boolean; content: { text: string }[] };
	};
	return { isError: answer.isError, text: answer.content[0].text };
}

describe('mcp', () => {
	it('keeps every write of concurrent calls', async () => {
		const { db, userId, caller } = await account();
		const genres = Array.from({ length: 12 }, (_, index) => `Genre ${index}`);

		const answers = await Promise.all(
			genres.map((genre, index) =>
				serveMcp(
					db,
					caller,
					call(
						'add_rows',
						{ base: 'Films', table: 'Movies', rows: [{ Title: genre, Genre: genre }] },
						(genres.length - index) * 5
					),
					'test'
				).then(result)
			)
		);

		expect(answers.filter((answer) => answer.isError)).toEqual([]);
		const ws = loadWorkspace(db, userId);
		const table = ws.tables(ws.bases()[0].id)[0];
		const genre = ws.fields(table.id).find((field) => field.name === 'Genre');
		expect(genre?.choices.map((choice) => choice.name).toSorted()).toEqual(genres.toSorted());
		expect(ws.rows(table.id)).toHaveLength(12);
	});

	it("shows each write as an undoable change in the token's own conversation, reads none", async () => {
		const { db, userId, caller } = await account();
		await serveMcp(db, caller, call('list_bases', {}), 'test');
		expect(listThreads(db, userId)).toEqual([]);

		await serveMcp(
			db,
			caller,
			call('add_rows', { base: 'Films', table: 'Movies', rows: [{ Title: 'Heat' }] }),
			'test'
		).then(result);
		const ws = loadWorkspace(db, userId);
		const table = ws.tables(ws.bases()[0].id)[0];
		const [row] = ws.rows(table.id);
		await serveMcp(
			db,
			caller,
			call('update_rows', {
				base: 'Films',
				table: 'Movies',
				updates: [{ id: row.id, values: { Title: 'Ronin' } }]
			}),
			'test'
		).then(result);

		const [listed] = listThreads(db, userId);
		expect(listed).toMatchObject({ title: 'Test', kind: 'tool' });
		expect(listThreads(db, userId)).toHaveLength(1);
		const actions = readActions(db, listed.id);
		expect(actions.map((action) => [action.summary, action.status])).toEqual([
			['Add 1 row to Movies', 'applied'],
			['Change 1 row in Movies', 'applied']
		]);
		const items = toItems(readRows(db, listed.id), actions);
		expect(items.map((item) => item.kind)).toEqual(['change', 'change']);
		expect(actions[1].before).toEqual([
			expect.objectContaining({
				id: row.id,
				set: expect.objectContaining({ [titleOf(ws, table.id)]: 'Heat' })
			})
		]);
	});

	it('lets a quick call through while a slow one is still uploading', async () => {
		const { db, caller } = await account();
		const finished: string[] = [];

		const slow = serveMcp(db, caller, call('list_bases', {}, 300), 'test').then(() =>
			finished.push('slow')
		);
		await pause(20);
		await serveMcp(db, caller, call('list_bases', {}), 'test').then(() => finished.push('quick'));
		await slow;

		expect(finished).toEqual(['quick', 'slow']);
	});

	it('answers a body that is not JSON with a parse error', async () => {
		const { db, caller } = await account();

		const response = await serveMcp(
			db,
			caller,
			new Request('http://torsel.test/api/mcp', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					accept: 'application/json, text/event-stream'
				},
				body: '{"jsonrpc":'
			}),
			'test'
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ error: { code: -32700 } });
	});

	it('refuses a page from another site, and serves its own and a client without one', async () => {
		const { db, caller } = await account();
		const from = (origin: string | null): Request => {
			const request = call('list_bases', {});
			if (origin !== null) request.headers.set('origin', origin);
			return request;
		};

		expect((await serveMcp(db, caller, from('https://evil.example'), 'test')).status).toBe(403);
		expect((await serveMcp(db, caller, from('null'), 'test')).status).toBe(403);
		expect((await serveMcp(db, caller, from('http://torsel.test'), 'test')).status).toBe(200);
		expect((await serveMcp(db, caller, from(null), 'test')).status).toBe(200);
	});

	it('answers GET and DELETE with 405, as a stateless server', async () => {
		const { db, caller } = await account();

		for (const method of ['GET', 'DELETE']) {
			const response = await serveMcp(
				db,
				caller,
				new Request('http://torsel.test/api/mcp', {
					method,
					headers: { accept: 'application/json, text/event-stream' }
				}),
				'test'
			);
			expect(response.status).toBe(405);
		}
	});

	it('shows a read token only the tools that read, and refuses it the rest', async () => {
		const { db, userId } = await account();
		const reader: McpCaller = { userId, tokenId: 'reader', label: 'Reader', access: 'read' };

		const listed = await serveMcp(db, reader, rpc('tools/list', {}), 'test');
		const { tools } = (await message(listed)).result as { tools: { name: string }[] };
		expect(tools.map((tool) => tool.name)).toEqual(['list_bases', 'describe_base', 'query']);

		const refused = await serveMcp(
			db,
			reader,
			call('add_rows', { base: 'Films', table: 'Movies', rows: [{ Title: 'Heat' }] }),
			'test'
		);
		expect(await message(refused)).toMatchObject({ error: { message: 'Tool add_rows not found' } });
		const ws = loadWorkspace(db, userId);
		expect(ws.rows(ws.tables(ws.bases()[0].id)[0].id)).toEqual([]);
	});

	it('caps the calls a token makes in a minute', async () => {
		const { db, userId } = await account();
		vi.stubEnv('TORSEL_MCP_CALLS_PER_MINUTE', '2');
		try {
			const caller: McpCaller = { userId, tokenId: 'busy', label: 'Busy', access: 'write' };
			const answers = [];
			for (let index = 0; index < 3; index += 1) {
				answers.push(await result(await serveMcp(db, caller, call('list_bases', {}), 'test')));
			}

			expect(answers.map((answer) => answer.isError ?? false)).toEqual([false, false, true]);
			expect(answers[2].text).toMatch(/more than 2 calls in the last minute; wait/u);
			const other: McpCaller = { userId, tokenId: 'calm', label: 'Calm', access: 'write' };
			expect(await result(await serveMcp(db, other, call('list_bases', {}), 'test'))).toMatchObject(
				{
					isError: undefined
				}
			);
		} finally {
			vi.unstubAllEnvs();
		}
	});
});
