import names from '#lib/i18n/names.ts';
import { describe, expect, it } from 'vitest';

import { createBase, createTable, defaultViews } from '../../core/actions.ts';
import { createUser } from '../auth/accounts.ts';
import { createDatabase } from '../db/client.ts';
import { runMigrations } from '../db/migrate.ts';
import { loadWorkspace, writeChanges } from '../db/records.ts';
import { serveMcp } from './mcp.ts';

type Database = ReturnType<typeof createDatabase>;

async function account(): Promise<{ db: Database; userId: string }> {
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

	return { db, userId: user.id };
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

async function result(response: Response): Promise<{ isError?: boolean; text: string }> {
	const message = (await response.json()) as {
		result: { isError?: boolean; content: { text: string }[] };
	};
	return { isError: message.result.isError, text: message.result.content[0].text };
}

describe('mcp', () => {
	it('keeps every write of concurrent calls', async () => {
		const { db, userId } = await account();
		const genres = Array.from({ length: 12 }, (_, index) => `Genre ${index}`);

		const answers = await Promise.all(
			genres.map((genre, index) =>
				serveMcp(
					db,
					userId,
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
		const { db, userId } = await account();
		const finished: string[] = [];

		const slow = serveMcp(db, userId, call('list_bases', {}, 300), 'test').then(() =>
			finished.push('slow')
		);
		await pause(20);
		await serveMcp(db, userId, call('list_bases', {}), 'test').then(() => finished.push('quick'));
		await slow;

		expect(finished).toEqual(['quick', 'slow']);
	});

	it('answers a body that is not JSON with a parse error', async () => {
		const { db, userId } = await account();

		const response = await serveMcp(
			db,
			userId,
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
});
