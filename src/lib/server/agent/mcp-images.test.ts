import type { Server } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createBase, createTable, defaultViews, insertRows } from '../../core/actions.ts';
import type { Workspace } from '../../core/workspace.ts';
import names from '../../i18n/names.ts';
import { createUser } from '../auth/accounts.ts';
import type { Database } from '../db/client.ts';
import { createDatabase } from '../db/client.ts';
import { runMigrations } from '../db/migrate.ts';
import { loadWorkspace, writeChanges } from '../db/records.ts';
import type { McpCaller } from './mcp.ts';
import { serveMcp } from './mcp.ts';

function png(w: number, h: number): Buffer {
	const head = Buffer.alloc(64);
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head);
	head.writeUInt32BE(13, 8);
	head.write('IHDR', 12, 'latin1');
	head.writeUInt32BE(w, 16);
	head.writeUInt32BE(h, 20);
	return head;
}

let server: Server;
let origin: string;
let hits: string[] = [];
let slow: { hold: boolean; release: () => void } = { hold: false, release: () => undefined };
let db: Database;
let userId: string;
let caller: McpCaller;
let table: string;

beforeAll(async () => {
	process.env.TORSEL_FETCH_PRIVATE = '1';
	server = createServer((request, response) => {
		const path = request.url ?? '/';
		hits.push(path);
		const answer = () => {
			if (response.headersSent) return;
			if (path.startsWith('/missing')) {
				response.writeHead(404);
				response.end();
				return;
			}
			response.writeHead(200, { 'content-type': 'image/png' });
			response.end(png(342, 513));
		};
		if (!slow.hold) {
			answer();
			return;
		}
		const timer = setTimeout(answer, 5000);
		const previous = slow.release;
		slow.release = () => {
			previous();
			clearTimeout(timer);
			answer();
		};
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
	server.close();
	delete process.env.TORSEL_FETCH_PRIVATE;
});

beforeEach(async () => {
	db = createDatabase(':memory:');
	runMigrations(db);
	userId = (await createUser(db, 'me@example.com', 'correct horse')).id;
	const ws = loadWorkspace(db, userId);
	const base = createBase(ws, 'Films');
	writeChanges(db, { user: userId, path: 'mcp' }, ws, base.changes);
	const made = createTable(
		ws,
		base.id,
		'Films',
		[
			{ name: 'Title', type: 'text' },
			{ name: 'Poster', type: 'image' },
			{ name: 'Still', type: 'text' }
		],
		() => defaultViews(names.en)
	);
	writeChanges(db, { user: userId, path: 'mcp' }, ws, made.changes);
	table = made.id;
	caller = { userId, tokenId: 'test', label: 'Test', access: 'write' };
	hits = [];
	slow = { hold: false, release: () => undefined };
});

function within<T>(promise: Promise<T>, ms = 3000): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_settle, fail) =>
			setTimeout(() => fail(new Error(`still pending after ${ms} ms`)), ms)
		)
	]);
}

async function tool(name: string, args: unknown): Promise<{ isError?: boolean; text: string }> {
	const response = await serveMcp(
		db,
		caller,
		new Request('http://torsel.test/api/mcp', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				accept: 'application/json, text/event-stream'
			},
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/call',
				params: { name, arguments: args }
			})
		}),
		'test'
	);
	const body = await response.text();
	const { result } = JSON.parse(
		body.startsWith('{') ? body : (/^data: (.*)$/mu.exec(body)?.[1] ?? '')
	) as { result: { isError?: boolean; content: { text: string }[] } };
	return { isError: result.isError, text: result.content[0].text };
}

function field(ws: Workspace, name: string): string {
	return ws.fields(table).find((candidate) => candidate.name === name)?.id ?? '';
}

function titled(ws: Workspace, title: string): Record<string, unknown> | undefined {
	return ws.rows(table).find((row) => row.data[field(ws, 'Title')] === title)?.data;
}

function seed(title: string, still: string): string {
	const ws = loadWorkspace(db, userId);
	const made = insertRows(ws, table, [
		{ [field(ws, 'Title')]: title, [field(ws, 'Still')]: still }
	]);
	writeChanges(db, { user: userId, path: 'mcp' }, ws, made.changes);
	return made.ids[0];
}

describe('mcp writes with image links', () => {
	it('store the image fetched once, then write the row', async () => {
		const answer = await within(
			tool('add_rows', {
				base: 'Films',
				table: 'Films',
				rows: [{ Title: 'Dune', Poster: `${origin}/dune.png` }]
			})
		);
		expect(answer.isError, answer.text).toBeFalsy();
		const ws = loadWorkspace(db, userId);
		expect(titled(ws, 'Dune')?.[field(ws, 'Poster')]).toMatchObject([
			{ type: 'image/png', w: 342, h: 513, src: `${origin}/dune.png` }
		]);
		expect(hits).toEqual(['/dune.png']);
	});

	it('write nothing when a link fails', async () => {
		const answer = await within(
			tool('add_rows', {
				base: 'Films',
				table: 'Films',
				rows: [
					{ Title: 'Dune', Poster: `${origin}/dune.png` },
					{ Title: 'Heat', Poster: `${origin}/missing.png` }
				]
			})
		);
		expect(answer.isError).toBe(true);
		expect(answer.text).toContain('missing.png was not stored');
		expect(loadWorkspace(db, userId).rows(table)).toEqual([]);
	});

	it('leave the account turn free while a 5 s image host answers', async () => {
		const alien = seed('Alien', `${origin}/alien.png`);
		slow.hold = true;
		const fetching = [
			tool('add_rows', {
				base: 'Films',
				table: 'Films',
				rows: [{ Title: 'Dune', Poster: `${origin}/dune.png` }]
			}),
			tool('update_rows', {
				base: 'Films',
				table: 'Films',
				updates: [{ id: alien, values: { Poster: `${origin}/alien-poster.png` } }]
			}),
			tool('update_field', { base: 'Films', table: 'Films', field: 'Still', type: 'image' })
		];
		let settled = 0;
		for (const call of fetching) void call.finally(() => (settled += 1));
		const plain = await within(
			tool('add_rows', { base: 'Films', table: 'Films', rows: [{ Title: 'Heat' }] }),
			1000
		);
		expect(plain.isError, plain.text).toBeFalsy();
		expect(settled).toBe(0);
		slow.hold = false;
		slow.release();
		for (const answer of await within(Promise.all(fetching))) {
			expect(answer.isError, answer.text).toBeFalsy();
		}
		const ws = loadWorkspace(db, userId);
		expect(titled(ws, 'Heat')).toBeDefined();
		expect(titled(ws, 'Dune')?.[field(ws, 'Poster')]).toMatchObject([{ type: 'image/png' }]);
		expect(titled(ws, 'Alien')?.[field(ws, 'Poster')]).toMatchObject([{ type: 'image/png' }]);
		expect(titled(ws, 'Alien')?.[field(ws, 'Still')]).toMatchObject([{ type: 'image/png' }]);
		expect([...hits].sort()).toEqual(['/alien-poster.png', '/alien.png', '/dune.png']);
	});
});
