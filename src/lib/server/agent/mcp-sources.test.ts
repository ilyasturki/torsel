import type { Server } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createBase, createTable, defaultViews } from '../../core/actions.ts';
import names from '../../i18n/names.ts';
import { createUser } from '../auth/accounts.ts';
import type { Database } from '../db/client.ts';
import { createDatabase } from '../db/client.ts';
import { runMigrations } from '../db/migrate.ts';
import { loadWorkspace, writeChanges } from '../db/records.ts';
import { serially } from '../db/serial.ts';
import { sourceHost } from '../sources/host.ts';
import type { McpCaller } from './mcp.ts';
import type { SourceHost } from './source-tools.ts';
import { serveMcp } from './mcp.ts';

const MOVIES = 'id,Title\n1,Alien\n2,Heat\n';

let server: Server;
let link: string;
// A slow site answers after 5 s, or when the test releases it.
let slow: { hold: boolean; release: () => void } = { hold: false, release: () => undefined };
let db: Database;
let userId: string;
let caller: McpCaller;

beforeAll(async () => {
	process.env.TORSEL_FETCH_PRIVATE = '1';
	process.env.TORSEL_SECRETS_KEY = 'a'.repeat(64);
	server = createServer((_request, response) => {
		const answer = () => {
			response.writeHead(200, { 'content-type': 'text/csv' });
			response.end(MOVIES);
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
	link = `http://127.0.0.1:${(server.address() as AddressInfo).port}/movies.csv`;
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
	const base = createBase(ws, 'Notes');
	writeChanges(db, { user: userId, path: 'mcp' }, ws, base.changes);
	const table = createTable(ws, base.id, 'Notes', [{ name: 'Title', type: 'text' }], () =>
		defaultViews(names.en)
	);
	writeChanges(db, { user: userId, path: 'mcp' }, ws, table.changes);
	caller = { userId, tokenId: 'test', label: 'Test', access: 'write' };
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

function movies(): Parameters<SourceHost['connect']>[0] {
	return {
		base: null,
		name: 'Movies',
		label: 'movies',
		url: link,
		auth: { kind: 'none', name: null },
		rows: null,
		key: 'id',
		filter: null,
		every: 'hour',
		missing: 'remove',
		columns: [
			{ path: 'id', name: 'id', type: 'text' },
			{ path: 'Title', name: 'Title', type: 'text' }
		]
	};
}

// Outside any turn, so the tool under test is the only nesting.
async function linked(name = 'Movies'): Promise<void> {
	expect((await within(sourceHost(db, userId).connect({ ...movies(), name }))).run.ok).toBe(true);
}

async function connected(): Promise<void> {
	const answer = await within(tool('connect_source', { url: link, name: 'Movies', key: 'id' }));
	expect(answer.isError, answer.text).toBeFalsy();
}

async function laterWriteLands(): Promise<void> {
	const answer = await within(
		tool('add_rows', { base: 'Notes', table: 'Notes', rows: [{ Title: 'after' }] })
	);
	expect(answer.isError, answer.text).toBeFalsy();
}

describe('mcp source tools inside the account turn', () => {
	it('connect_source resolves, and a later write too', async () => {
		await connected();
		await laterWriteLands();
	});

	it('refresh_source resolves, and a later write too', async () => {
		await linked();
		const answer = await within(tool('refresh_source', { table: 'Movies' }));
		expect(answer.isError, answer.text).toBeFalsy();
		await laterWriteLands();
	});

	it('update_source stop resolves, and a later write too', async () => {
		await linked();
		const answer = await within(tool('update_source', { table: 'Movies', stop: true }));
		expect(answer.isError, answer.text).toBeFalsy();
		await laterWriteLands();
	});

	it('update_source with a new link resolves, and a later write too', async () => {
		await linked();
		const answer = await within(tool('update_source', { table: 'Movies', url: `${link}?v=2` }));
		expect(answer.isError, answer.text).toBeFalsy();
		await laterWriteLands();
	});
});

describe('a slow source fetch', () => {
	it('leaves the account turn free for other writes', async () => {
		await linked('Movies');
		await linked('Films');
		slow.hold = true;
		const fetching = [
			tool('connect_source', { url: link, name: 'Series', key: 'id' }),
			tool('refresh_source', { table: 'Movies' }),
			tool('update_source', { table: 'Films', url: `${link}?v=2` })
		];
		let settled = 0;
		for (const call of fetching) void call.finally(() => (settled += 1));
		await within(laterWriteLands(), 1000);
		expect(settled).toBe(0);
		slow.hold = false;
		slow.release();
		for (const answer of await within(Promise.all(fetching))) {
			expect(answer.isError, answer.text).toBeFalsy();
		}
		const ws = loadWorkspace(db, userId);
		const notes = ws
			.bases()
			.flatMap((base) => ws.tables(base.id))
			.find((t) => t.name === 'Notes');
		expect(ws.rows(notes?.id ?? '').length).toBe(1);
		expect(
			ws
				.bases()
				.flatMap((base) => ws.tables(base.id))
				.map((t) => t.name)
		).toContain('Series');
	});
});

describe("the assistant's source host", () => {
	it('connects, refreshes and stops, and the account turn is free after', async () => {
		const sources = sourceHost(db, userId);
		const made = await within(sources.connect(movies()));
		expect(made.run.ok).toBe(true);
		expect((await within(sources.refresh(made.table))).ok).toBe(true);
		await within(sources.stop(made.table));
		expect(await within(serially(userId, async () => 'free'))).toBe('free');
	});
});
