import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PATH, SOURCE } from '../../core/access.ts';
import { presetSource } from '../../core/presets.ts';
import catalogs from '../../i18n/sources.ts';
import { deleteRecords, updateRecord } from '../../core/actions.ts';
import type { Rec, Value } from '../../core/model.ts';
import { isDeleted } from '../../core/model.ts';
import { sourceMark } from '../../core/source.ts';
import { createUser } from '../auth/accounts.ts';
import type { Database } from '../db/client.ts';
import { createDatabase } from '../db/client.ts';
import { runMigrations } from '../db/migrate.ts';
import { loadWorkspace, syncExchange, writeChanges } from '../db/records.ts';
import type { SourceSpec } from './connect.ts';
import { createSource, patchSource, previewSource, stopSource } from './connect.ts';
import { guardedFetch } from '../net/guard.ts';
import { sourceHost } from './host.ts';
import { CONNECTOR, rowIdOf, runSource } from './run.ts';
import { tick } from './schedule.ts';
import { keyFile, open, seal } from './secrets.ts';
import { readSource, updateSource } from './store.ts';

type Answer = { status?: number; type?: string; body: string; headers?: Record<string, string> };

let server: Server;
let base: string;
let answers: Record<string, Answer> = {};
let hits: { path: string; authorization?: string }[] = [];

beforeAll(async () => {
	process.env.TORSEL_FETCH_PRIVATE = '1';
	process.env.TORSEL_SECRETS_KEY = 'a'.repeat(64);
	server = createServer((request, response) => {
		const path = new URL(request.url ?? '/', 'http://x').pathname;
		hits.push({ path, authorization: request.headers.authorization });
		const answer = answers[path];
		if (answer === undefined) {
			response.writeHead(404);
			response.end();
			return;
		}
		response.writeHead(answer.status ?? 200, {
			'content-type': answer.type ?? 'text/csv',
			...answer.headers
		});
		response.end(answer.body);
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
	server.close();
	delete process.env.TORSEL_FETCH_PRIVATE;
});

let db: Database;
let userId: string;

beforeEach(async () => {
	answers = {};
	hits = [];
	db = createDatabase(':memory:');
	runMigrations(db);
	userId = (await createUser(db, 'me@example.com', 'correct horse')).id;
});

const MOVIES = 'id,Title,Rating,Genre\n1,Alien,4,Horror\n2,Heat,5,Crime\n';

function spec(path: string, extra: Partial<SourceSpec> = {}): SourceSpec {
	return {
		base: null,
		name: 'Movies',
		label: 'example.com',
		url: `${base}${path}`,
		auth: { kind: 'none', name: null },
		secret: null,
		rows: null,
		key: 'id',
		filter: null,
		every: 'hour',
		missing: 'remove',
		columns: [
			{ path: 'Title', name: 'Title', type: 'text' },
			{ path: 'Rating', name: 'Rating', type: 'number' },
			{ path: 'Genre', name: 'Genre', type: 'choice', choices: ['Horror'] }
		],
		...extra
	};
}

function tableOf(table: string) {
	const ws = loadWorkspace(db, userId);
	const fields = Object.fromEntries(ws.fields(table).map((field) => [field.name, field.id]));
	const rows = ws.rows(table).map((row): Record<string, Value> => ({
		id: row.id,
		...Object.fromEntries(Object.entries(fields).map(([name, id]) => [name, row.data[id]]))
	}));
	return { ws, fields, rows };
}

const watermark = (): number =>
	syncExchange(db, { user: userId, path: 'device' }, { watermark: 0, push: [] }).watermark;

describe('a source run', () => {
	it('makes a read-only table and fills it with rows keyed by the source', async () => {
		answers['/movies.csv'] = { body: MOVIES };
		const made = await createSource(db, userId, spec('/movies.csv'));
		const outcome = await runSource(db, userId, made.table);
		expect(outcome).toMatchObject({ ok: true, added: 2, changed: 0, removed: 0, problem: null });

		const { ws, fields, rows } = tableOf(made.table);
		expect(sourceMark(ws.get(made.table))).toMatchObject({ name: 'example.com', problem: null });
		expect(ws.get(fields.Title)?.data[PATH]).toBe('Title');
		expect(ws.views(made.table).map((view) => view.type)).toEqual(['grid']);
		expect(rows).toEqual([
			{ id: rowIdOf(made.table, '1'), Title: 'Alien', Rating: 4, Genre: 'Horror' },
			{ id: rowIdOf(made.table, '2'), Title: 'Heat', Rating: 5, Genre: 'Crime' }
		]);
		expect(ws.field(fields.Genre)?.choices.map((choice) => choice.name)).toEqual([
			'Horror',
			'Crime'
		]);
		expect(readSource(db, userId, made.table)?.nextAt?.getTime()).toBeGreaterThan(Date.now());
	});

	it('writes nothing when the source has not changed, and only the moved values when it has', async () => {
		answers['/movies.csv'] = { body: MOVIES };
		const made = await createSource(db, userId, spec('/movies.csv'));
		await runSource(db, userId, made.table);
		const settled = watermark();

		await runSource(db, userId, made.table, { now: () => Date.now() });
		// The table's mark says when it last read: one record, nothing in the rows.
		expect(watermark() - settled).toBeLessThanOrEqual(1);

		answers['/movies.csv'] = { body: 'id,Title,Rating,Genre\n1,Alien,5,Horror\n2,Heat,5,Crime\n' };
		const before = watermark();
		expect(await runSource(db, userId, made.table)).toMatchObject({ changed: 1, added: 0 });
		expect(watermark() - before).toBe(2);
		expect(tableOf(made.table).rows[0].Rating).toBe(5);
	});

	it('removes rows gone from the source, or keeps them, and brings one back when it returns', async () => {
		answers['/movies.csv'] = { body: MOVIES };
		const removing = await createSource(db, userId, spec('/movies.csv'));
		const keeping = await createSource(
			db,
			userId,
			spec('/movies.csv', { name: 'Kept', missing: 'keep' })
		);
		await runSource(db, userId, removing.table);
		await runSource(db, userId, keeping.table);

		answers['/movies.csv'] = { body: 'id,Title,Rating,Genre\n2,Heat,5,Crime\n' };
		expect(await runSource(db, userId, removing.table)).toMatchObject({ removed: 1 });
		expect(await runSource(db, userId, keeping.table)).toMatchObject({ removed: 0 });
		expect(tableOf(removing.table).rows.map((row) => row.Title)).toEqual(['Heat']);
		expect(tableOf(keeping.table).rows.map((row) => row.Title)).toEqual(['Alien', 'Heat']);

		answers['/movies.csv'] = { body: MOVIES };
		expect(await runSource(db, userId, removing.table)).toMatchObject({ added: 1 });
		const back = tableOf(removing.table).rows.find((row) => row.Title === 'Alien');
		expect(back?.id).toBe(rowIdOf(removing.table, '1'));
	});

	it('leaves the person’s own field alone through every run', async () => {
		answers['/movies.csv'] = { body: MOVIES };
		const made = await createSource(db, userId, spec('/movies.csv'));
		await runSource(db, userId, made.table);
		const ws = loadWorkspace(db, userId);
		const notes = {
			id: 'f_notes000000',
			kind: 'field' as const,
			base: made.base,
			parent: made.table
		};
		writeChanges(db, { user: userId, path: 'device' }, ws, [
			{ ...notes, set: { name: 'Notes', type: 'text', order: 9 } },
			...updateRecord(ws, rowIdOf(made.table, '1'), { [notes.id]: 'seen twice' })
		]);
		answers['/movies.csv'] = { body: 'id,Title,Rating,Genre\n1,Alien,3,Horror\n2,Heat,5,Crime\n' };
		await runSource(db, userId, made.table);
		expect(tableOf(made.table).rows[0]).toMatchObject({ Rating: 3, Notes: 'seen twice' });
	});

	it('deletes nothing when a run fails, and shows the problem only once it lasts', async () => {
		answers['/movies.csv'] = { body: MOVIES };
		const made = await createSource(db, userId, spec('/movies.csv'));
		await runSource(db, userId, made.table);
		answers['/movies.csv'] = { status: 500, body: '' };

		for (let run = 1; run <= 3; run += 1) {
			expect(await runSource(db, userId, made.table)).toEqual({ ok: false, problem: 'status' });
			const { ws, rows } = tableOf(made.table);
			expect(rows).toHaveLength(2);
			expect(sourceMark(ws.get(made.table))?.problem).toBe(run < 3 ? null : 'status');
		}
		expect(readSource(db, userId, made.table)).toMatchObject({ failures: 3, problem: 'status' });

		answers['/movies.csv'] = { body: MOVIES };
		await runSource(db, userId, made.table);
		expect(sourceMark(tableOf(made.table).ws.get(made.table))?.problem).toBeNull();
		expect(readSource(db, userId, made.table)?.failures).toBe(0);
	});

	it('keeps a filled table when the source answers with no rows', async () => {
		answers['/movies.csv'] = { body: MOVIES };
		const made = await createSource(db, userId, spec('/movies.csv'));
		await runSource(db, userId, made.table);
		answers['/movies.csv'] = { type: 'application/json', body: '[]' };
		expect(await runSource(db, userId, made.table)).toMatchObject({
			ok: true,
			problem: 'empty',
			removed: 0
		});
		expect(tableOf(made.table).rows).toHaveLength(2);
	});

	it('takes the first rows up to the cap and removes none past it', async () => {
		process.env.TORSEL_SOURCE_ROWS = '1';
		try {
			answers['/movies.csv'] = { body: MOVIES };
			const made = await createSource(db, userId, spec('/movies.csv'));
			expect(await runSource(db, userId, made.table)).toMatchObject({ added: 1, problem: 'cap' });
			expect(sourceMark(tableOf(made.table).ws.get(made.table))?.problem).toBe('cap');
		} finally {
			delete process.env.TORSEL_SOURCE_ROWS;
		}
	});

	it('writes nothing when syncing stops while it reads', async () => {
		answers['/movies.csv'] = { body: MOVIES };
		const made = await createSource(db, userId, spec('/movies.csv'));
		await runSource(db, userId, made.table);
		answers['/movies.csv'] = { body: 'id,Title,Rating,Genre\n3,Ran,5,Drama\n' };
		const stopFirst: typeof guardedFetch = async (target, options) => {
			await stopSource(db, userId, made.table);
			return guardedFetch(target, options);
		};

		expect(await runSource(db, userId, made.table, { get: stopFirst })).toEqual({
			ok: false,
			problem: 'gone'
		});
		expect(tableOf(made.table).rows.map((row) => row.Title)).toEqual(['Alien', 'Heat']);
	});

	it('refuses to keep rows gone from a source with no key', async () => {
		await expect(
			createSource(db, userId, spec('/movies.csv', { key: null, missing: 'keep' }))
		).rejects.toMatchObject({ reason: 'key' });
	});

	it('pauses on a deleted table and comes back with it', async () => {
		answers['/movies.csv'] = { body: MOVIES };
		const made = await createSource(db, userId, spec('/movies.csv'));
		const ws = loadWorkspace(db, userId);
		writeChanges(db, { user: userId, path: 'device' }, ws, deleteRecords(ws, [made.table]));
		expect(await runSource(db, userId, made.table)).toEqual({ ok: false, problem: 'gone' });
		expect(hits).toEqual([]);
	});

	it('signs with its sealed key, and waits for one when it has none', async () => {
		answers['/private.csv'] = { body: MOVIES };
		const keyed = await createSource(
			db,
			userId,
			spec('/private.csv', { auth: { kind: 'bearer', name: null }, secret: 'tok-123456789' })
		);
		const stored = readSource(db, userId, keyed.table);
		expect(stored?.secret).not.toContain('tok');
		expect(stored?.hint).toBe('6789');
		await runSource(db, userId, keyed.table);
		expect(hits.at(-1)?.authorization).toBe('Bearer tok-123456789');

		hits = [];
		const pending = await createSource(
			db,
			userId,
			spec('/private.csv', { name: 'Pending', auth: { kind: 'bearer', name: null } })
		);
		expect(await runSource(db, userId, pending.table)).toEqual({ ok: false, problem: 'auth' });
		expect(hits).toEqual([]);
		expect(readSource(db, userId, pending.table)?.nextAt).toBeNull();

		patchSource(db, userId, pending.table, { secret: 'tok-abcdefghij' });
		expect(await runSource(db, userId, pending.table)).toMatchObject({ ok: true, added: 2 });
	});

	it('keeps a key for its own site: a link moved elsewhere asks for it again', async () => {
		answers['/private.csv'] = { body: MOVIES };
		const made = await createSource(
			db,
			userId,
			spec('/private.csv', { auth: { kind: 'bearer', name: null }, secret: 'tok-123456789' })
		);
		patchSource(db, userId, made.table, { url: `${base}/other.csv` });
		expect(readSource(db, userId, made.table)?.secret).not.toBeNull();

		patchSource(db, userId, made.table, { url: 'https://attacker.example/collect.csv' });
		expect(readSource(db, userId, made.table)).toMatchObject({ secret: null, hint: null });
		hits = [];
		expect(await runSource(db, userId, made.table)).toEqual({ ok: false, problem: 'auth' });
		expect(hits).toEqual([]);
	});

	it('moves a key pasted in the link into the sealed secret', async () => {
		answers['/q.csv'] = { body: MOVIES };
		const made = await createSource(
			db,
			userId,
			spec('/q.csv?api_key=inline-secret&x=1', { auth: { kind: 'query', name: 'api_key' } })
		);
		const stored = readSource(db, userId, made.table);
		expect(stored?.url).toBe(`${base}/q.csv?x=1`);
		expect(open(stored?.secret ?? '', `${userId}:${made.table}`)).toBe('inline-secret');
	});

	it('stops syncing: the source goes, the rows stay and every field is the person’s again', async () => {
		answers['/movies.csv'] = { body: MOVIES };
		const made = await createSource(db, userId, spec('/movies.csv'));
		await runSource(db, userId, made.table);
		await stopSource(db, userId, made.table);
		const { ws, fields, rows } = tableOf(made.table);
		expect(ws.get(made.table)?.data[SOURCE]).toBeNull();
		expect(ws.get(fields.Title)?.data[PATH]).toBeNull();
		expect(rows).toHaveLength(2);
		expect(readSource(db, userId, made.table)).toBeUndefined();
		expect(rows.every((row) => !isDeleted(ws.get(String(row.id)) as Rec))).toBe(true);
	});

	it('refuses past the number of sources an account may keep', async () => {
		process.env.TORSEL_SOURCES = '1';
		try {
			answers['/movies.csv'] = { body: MOVIES };
			const first = await createSource(db, userId, spec('/movies.csv'));
			await expect(
				createSource(db, userId, spec('/movies.csv', { name: 'Two' }))
			).rejects.toMatchObject({
				reason: 'count'
			});
			const ws = loadWorkspace(db, userId);
			writeChanges(db, { user: userId, path: 'device' }, ws, deleteRecords(ws, [first.table]));
			await expect(
				createSource(db, userId, spec('/movies.csv', { name: 'Two' }))
			).resolves.toMatchObject({ base: first.base });
		} finally {
			delete process.env.TORSEL_SOURCES;
		}
	});

	it('only writes what a connector writes as one', async () => {
		answers['/movies.csv'] = { body: MOVIES };
		const made = await createSource(db, userId, spec('/movies.csv'));
		const ws = loadWorkspace(db, userId);
		const refused = syncExchange(
			db,
			{ user: userId, path: 'device' },
			{
				watermark: 0,
				push: [
					{
						...(ws.get(made.table) as Rec),
						data: { [SOURCE]: null },
						clocks: { [SOURCE]: '9999999999999:0000:zz' }
					}
				]
			}
		);
		expect(refused.refused).toEqual([{ id: made.table, keys: [SOURCE] }]);
		writeChanges(db, CONNECTOR(userId), ws, updateRecord(ws, made.table, { [SOURCE]: null }));
		expect(loadWorkspace(db, userId).get(made.table)?.data[SOURCE]).toBeNull();
	});
});

describe('the Letterboxd preset', () => {
	it('fills a diary from the feed, lists left out, ratings in half stars', async () => {
		answers['/sample/rss/'] = {
			type: 'application/rss+xml',
			body: readFileSync(join(import.meta.dirname, 'fixtures/letterboxd.xml'), 'utf8')
		};
		const preset = presetSource('letterboxd', 'sample', catalogs.en);
		if (preset === null) throw new Error('no preset');
		const made = await createSource(db, userId, {
			...spec('/sample/rss/'),
			name: preset.name,
			label: preset.label,
			key: preset.key,
			filter: preset.filter,
			missing: preset.missing,
			columns: preset.columns ?? []
		});
		expect(await runSource(db, userId, made.table)).toMatchObject({ ok: true, added: 3 });
		const { rows } = tableOf(made.table);
		expect(rows.map((row) => ({ ...row, id: undefined }))).toEqual([
			{
				Title: expect.any(String),
				Year: expect.any(Number),
				'Date watched': expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/u),
				Rating: null,
				Favorite: expect.any(Boolean),
				Rewatch: expect.any(Boolean),
				Link: expect.stringMatching(/^https:\/\/letterboxd\.com\//u)
			},
			expect.objectContaining({
				Title: 'Doctor Strange in the Multiverse of Madness',
				Year: 2022,
				Rating: 3.5,
				Favorite: true,
				Rewatch: true
			}),
			expect.objectContaining({
				Title: 'Backrooms',
				Year: 2026,
				'Date watched': '2026-11-15',
				Rating: 3.5,
				Favorite: false
			})
		]);
	});
});

describe('the scheduler', () => {
	it('runs due sources two at a time, never a manual one', async () => {
		answers['/movies.csv'] = { body: MOVIES };
		const tables = [];
		for (const name of ['One', 'Two', 'Three']) {
			tables.push((await createSource(db, userId, spec('/movies.csv', { name }))).table);
		}
		const manual = await createSource(
			db,
			userId,
			spec('/movies.csv', { name: 'Hand', every: 'manual' })
		);
		const past = new Date(Date.now() - 1000);
		for (const table of [...tables, manual.table])
			updateSource(db, userId, table, { nextAt: past });

		await Promise.all(tick(db));
		const ran = tables.filter((table) => readSource(db, userId, table)?.lastAt !== null);
		expect(ran).toHaveLength(2);
		expect(readSource(db, userId, manual.table)?.lastAt).toBeNull();

		await Promise.all(tick(db));
		expect(tables.every((table) => readSource(db, userId, table)?.lastAt !== null)).toBe(true);
		expect(readSource(db, userId, manual.table)?.lastAt).toBeNull();
	});
});

describe('the preview', () => {
	it('reads the first page as typed columns, a few rows and a key', async () => {
		answers['/movies.csv'] = { body: MOVIES };
		const preview = await previewSource({
			url: `${base}/movies.csv`,
			auth: { kind: 'none', name: null },
			secret: null,
			rows: null
		});
		expect(preview).toMatchObject({ format: 'csv', count: 2, more: false, key: 'id' });
		expect(preview.columns.map(({ path, type }) => [path, type])).toEqual([
			['id', 'number'],
			['Title', 'text'],
			['Rating', 'number'],
			['Genre', 'text']
		]);
	});
});

describe('secrets', () => {
	it('opens only under its key and for its own source', () => {
		const key = Buffer.alloc(32, 7);
		const sealed = seal('hunter2', 'u:t1', key);
		expect(open(sealed, 'u:t1', key)).toBe('hunter2');
		expect(open(sealed, 'u:t2', key)).toBeNull();
		expect(open(sealed, 'u:t1', Buffer.alloc(32, 8))).toBeNull();
		expect(open('garbage', 'u:t1', key)).toBeNull();
	});

	it('makes one key file beside the database and reads the same one after', () => {
		const dir = mkdtempSync(join(tmpdir(), 'torsel-key-'));
		try {
			const first = keyFile(dir);
			expect(first).toHaveLength(32);
			expect(keyFile(dir).equals(first)).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe('the assistant’s source host', () => {
	it('takes a new link for a linked table, but never one that carries its key', async () => {
		const made = await createSource(
			db,
			userId,
			spec('/movies.csv', { auth: { kind: 'query', name: 'key' }, secret: 'k1' })
		);
		const host = sourceHost(db, userId);
		expect(() => host.update(made.table, { url: `${base}/films.csv?key=leaked` })).toThrow(
			expect.objectContaining({ code: 'inline' })
		);
		expect(readSource(db, userId, made.table)?.url).toBe(`${base}/movies.csv`);
		host.update(made.table, { url: `${base}/films.csv` });
		expect(readSource(db, userId, made.table)?.url).toBe(`${base}/films.csv`);
		expect(() => host.update(made.table, { url: 'ftp://x' })).toThrow(
			expect.objectContaining({ code: 'url' })
		);
	});
});
