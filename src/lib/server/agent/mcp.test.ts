import names from '#lib/i18n/names.ts';
import { describe, expect, it } from 'vitest';

import { createBase, createTable, defaultViews } from '../../core/actions.ts';
import { createUser } from '../auth/accounts.ts';
import { createDatabase } from '../db/client.ts';
import { runMigrations } from '../db/migrate.ts';
import { loadWorkspace, writeChanges } from '../db/records.ts';
import type { McpCaller } from './mcp.ts';
import { serveMcp } from './mcp.ts';

type Database = ReturnType<typeof createDatabase>;

async function account(): Promise<{ db: Database; userId: string; caller: McpCaller }> {
	const db = createDatabase(':memory:');
	runMigrations(db);
	const user = await createUser(db, 'me@example.com', 'correct horse');

	const ws = loadWorkspace(db, user.id);
	const base = createBase(ws, 'Films');
	writeChanges(db, user.id, ws, base.changes);
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
	writeChanges(db, user.id, ws, table.changes);

	return { db, userId: user.id, caller: { userId: user.id, tokenId: 'test' } };
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

// A 2025-era answer comes as one SSE event or as JSON.
async function result(response: Response): Promise<{ isError?: boolean; text: string }> {
	const body = await response.text();
	const json = body.startsWith('{') ? body : (/^data: (.*)$/mu.exec(body)?.[1] ?? '');
	const message = JSON.parse(json) as {
		result: { isError?: boolean; content: { text: string }[] };
	};
	return { isError: message.result.isError, text: message.result.content[0].text };
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
});
