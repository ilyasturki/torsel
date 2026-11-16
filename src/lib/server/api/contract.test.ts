import type { RequestEvent } from '@sveltejs/kit';
import names from '#lib/i18n/names.ts';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createBase, createTable, defaultViews, updateRecord } from '../../core/actions.ts';
import { createUser, issueToken } from '../auth/accounts.ts';
import type { Database } from '../db/client.ts';
import { createDatabase } from '../db/client.ts';
import { runMigrations } from '../db/migrate.ts';
import { loadWorkspace, writeChanges } from '../db/records.ts';
import { execute } from '../agent/mcp.ts';
import type { Tool } from '../agent/toolkit.ts';
import { toolNamed } from '../agent/toolkit.ts';
import { createHandle } from '../http/handle.ts';
import { OPERATIONS } from './v1.ts';

const shared = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock('../db/client.ts', async (original) => ({
	...(await original<typeof import('../db/client.ts')>()),
	getDatabase: () => shared.db
}));

type Handler = (event: RequestEvent) => Promise<Response> | Response;
type Module = Record<string, Handler>;

const ROUTES = Object.entries(
	import.meta.glob<Module>('/src/routes/api/v1/**/+server.ts', { eager: true })
).map(([file, module]) => {
	const route = file.slice('/src/routes'.length, -'/+server.ts'.length);
	const names: string[] = [];
	const pattern = route.replaceAll(/\[(\w+)\]/gu, (_, name: string) => {
		names.push(name);
		return '([^/]+)';
	});
	return { route, module, names, regex: new RegExp(`^${pattern}$`, 'u') };
});

const ORIGIN = 'https://torsel.test';

let db: Database;
let userId: string;
let writer: string;
let reader: string;
let doc: {
	openapi: string;
	paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
	components: { schemas: Record<string, unknown> };
};
const seen = new Set<string>();

function matchRoute(pathname: string) {
	for (const route of ROUTES) {
		const found = route.regex.exec(pathname);
		if (found !== null) {
			const params = Object.fromEntries(
				route.names.map((name, index) => [name, decodeURIComponent(found[index + 1])])
			);
			return { ...route, params };
		}
	}
	return undefined;
}

/** The OpenAPI path a concrete path answers to. */
function template(route: string): string {
	return route.slice('/api/v1'.length).replaceAll(/\[(\w+)\]/gu, '{$1}');
}

function validator(schema: unknown): z.ZodType {
	const linked = JSON.stringify({
		...(schema as object),
		$defs: doc.components.schemas
	}).replaceAll('#/components/schemas/', '#/$defs/');
	return z.fromJSONSchema(JSON.parse(linked));
}

type Answer = { status: number; body: any; headers: Headers };

async function call(
	method: string,
	path: string,
	options: { token?: string | null; body?: unknown; raw?: string } = {}
): Promise<Answer> {
	const url = new URL(path, ORIGIN);
	const token = options.token === undefined ? writer : options.token;
	const headers: Record<string, string> = {};
	if (token !== null) headers.authorization = `Bearer ${token}`;
	if (options.body !== undefined || options.raw !== undefined) {
		headers['content-type'] = 'application/json';
	}
	const request = new Request(url, {
		method,
		headers,
		body: options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body))
	});
	const matched = matchRoute(url.pathname);
	if (matched === undefined) throw new Error(`no route for ${path}`);
	const event = {
		url,
		request,
		params: matched.params,
		route: { id: matched.route },
		cookies: { get: () => undefined },
		locals: {}
	} as unknown as RequestEvent;
	const response = await createHandle(() => db)({
		event,
		resolve: async (resolved) => {
			const handler = matched.module[method];
			if (handler === undefined) return new Response(null, { status: 405 });
			return handler(resolved);
		}
	});
	const text = await response.text();
	const body = text === '' ? null : JSON.parse(text);

	const operation = doc?.paths[template(matched.route)]?.[method.toLowerCase()];
	if (operation !== undefined) {
		const described = operation.responses[String(response.status)] as
			{ content: { 'application/json': { schema: unknown } } } | undefined;
		expect(described, `${method} ${path} answered ${response.status}`).toBeDefined();
		const result = validator(described?.content['application/json'].schema).safeParse(body);
		expect(result.success, `${method} ${path} ${response.status}: ${JSON.stringify(body)}`).toBe(
			true
		);
		seen.add(`${method.toLowerCase()} ${template(matched.route)} ${response.status}`);
	}
	return { status: response.status, body, headers: response.headers };
}

beforeAll(async () => {
	vi.stubEnv('ORIGIN', ORIGIN);
	db = createDatabase(':memory:');
	shared.db = db;
	runMigrations(db);
	const user = await createUser(db, 'me@example.com', 'correct horse');
	userId = user.id;
	writer = issueToken(db, user.id, 'Shortcut', 'api').token;
	reader = issueToken(db, user.id, 'Dashboard', 'api', null, 'read').token;

	const actor = { user: user.id, path: 'device' as const };
	const ws = loadWorkspace(db, user.id);
	const base = createBase(ws, 'Training');
	writeChanges(db, actor, ws, base.changes);
	const sets = createTable(
		ws,
		base.id,
		'Sets',
		[
			{ name: 'Exercise', type: 'text' },
			{ name: 'Weight', type: 'number' },
			{ name: 'Muscle', type: 'choice' },
			{ name: 'Day', type: 'date' },
			{ name: 'Done', type: 'check' }
		],
		() => defaultViews(names.en)
	);
	writeChanges(db, actor, ws, sets.changes);
	const feed = createTable(ws, base.id, 'Feed', [{ name: 'Title', type: 'text' }], () =>
		defaultViews(names.en)
	);
	writeChanges(db, actor, ws, feed.changes);
	writeChanges(
		db,
		{ user: user.id, path: 'connector' },
		ws,
		updateRecord(ws, feed.id, { source: 'https://example.com/feed.csv' })
	);
	const other = createBase(ws, 'Money');
	writeChanges(db, actor, ws, other.changes);

	doc = (await call('GET', '/api/v1/openapi.json', { token: null })).body;
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.stubEnv('ORIGIN', ORIGIN);
});

describe('the OpenAPI document', () => {
	it('is OpenAPI 3.1 with the token and OAuth schemes', () => {
		expect(doc.openapi).toMatch(/^3\.1\./u);
		expect(doc).toMatchObject({
			servers: [{ url: `${ORIGIN}/api/v1` }],
			components: {
				securitySchemes: {
					token: { type: 'http', scheme: 'bearer' },
					oauth: {
						type: 'oauth2',
						flows: {
							authorizationCode: {
								authorizationUrl: `${ORIGIN}/oauth/authorize`,
								tokenUrl: `${ORIGIN}/api/oauth/token`
							}
						}
					}
				}
			}
		});
	});

	it('describes every route file and method, and nothing else', () => {
		const served = ROUTES.filter(({ route }) => route !== '/api/v1/openapi.json').flatMap(
			({ route, module }) =>
				Object.keys(module)
					.filter((method) => /^[A-Z]+$/u.test(method))
					.map((method) => `${method.toLowerCase()} ${template(route)}`)
		);
		const described = Object.entries(doc.paths).flatMap(([path, methods]) =>
			Object.keys(methods).map((method) => `${method} ${path}`)
		);
		expect(served.sort()).toEqual(described.sort());
		expect(OPERATIONS.length).toBe(described.length);
	});
});

describe('the REST API', () => {
	let squat: string;
	let bench: string;

	it('lists the bases and reads a schema', async () => {
		const bases = await call('GET', '/api/v1/bases');
		expect(bases.status).toBe(200);
		expect(bases.body.bases.map((base: { name: string }) => base.name)).toEqual([
			'Training',
			'Money'
		]);
		const schema = await call('GET', '/api/v1/bases/Training');
		expect(schema.body.tables[0].fields.map((field: { name: string }) => field.name)).toEqual([
			'Exercise',
			'Weight',
			'Muscle',
			'Day',
			'Done'
		]);
		expect((await call('GET', '/api/v1/bases/Nope')).status).toBe(404);
	});

	it('refuses a request without a token, or with one it does not know', async () => {
		const bare = await call('GET', '/api/v1/bases', { token: null });
		expect(bare.status).toBe(401);
		expect(bare.headers.get('www-authenticate')).toContain('api/v1');
		expect((await call('GET', '/api/v1/bases', { token: 'ts_nope' })).status).toBe(401);
	});

	it('adds rows by field name, adding unseen choices, and answers with them as stored', async () => {
		const added = await call('POST', '/api/v1/bases/Training/tables/Sets/rows', {
			body: {
				rows: [
					{ Exercise: 'Squat', Weight: 100, Muscle: 'Legs', Day: '2026-11-16', Done: true },
					{ Exercise: 'Bench', Weight: '80', Muscle: 'Chest' }
				]
			}
		});
		expect(added.status).toBe(201);
		expect(added.body.rows.map((row: { fields: unknown }) => row.fields)).toEqual([
			{ Exercise: 'Squat', Weight: 100, Muscle: 'Legs', Day: '2026-11-16', Done: true },
			{ Exercise: 'Bench', Weight: 80, Muscle: 'Chest', Day: null, Done: null }
		]);
		[squat, bench] = added.body.rows.map((row: { id: string }) => row.id);
		const schema = await call('GET', '/api/v1/bases/Training');
		expect(schema.body.tables[0].fields[2].choices).toEqual(['Legs', 'Chest']);
	});

	it('refuses what the fields cannot hold, and writes none of it', async () => {
		const refused = await call('POST', '/api/v1/bases/Training/tables/Sets/rows', {
			body: { rows: [{ Exercise: 'Row' }, { Weight: 'heavy' }] }
		});
		expect(refused.status).toBe(422);
		expect(refused.body.error.message).toContain('"Weight"');
		const unknown = await call('POST', '/api/v1/bases/Training/tables/Sets/rows', {
			body: { rows: [{ Reps: 5 }] }
		});
		expect(unknown.status).toBe(422);
		expect((await call('GET', '/api/v1/bases/Training/tables/Sets/rows')).body.rows).toHaveLength(
			2
		);
	});

	it('refuses a body or query string that does not fit', async () => {
		const path = '/api/v1/bases/Training/tables/Sets/rows';
		expect((await call('POST', path, { raw: '{' })).body.error.code).toBe('invalid');
		expect((await call('POST', path, { body: { rows: [] } })).status).toBe(400);
		expect((await call('POST', path, { body: { rows: [{}], extra: 1 } })).status).toBe(400);
		expect((await call('GET', `${path}?limit=0`)).status).toBe(400);
		expect((await call('GET', `${path}?limit=many`)).status).toBe(400);
		expect((await call('GET', `${path}?sort=Weight`)).status).toBe(400);
		expect((await call('GET', `${path}?cursor=nope`)).status).toBe(400);
	});

	it('pages through rows with a cursor, picking fields by name and keying by id', async () => {
		const path = '/api/v1/bases/Training/tables/Sets/rows';
		const first = await call('GET', `${path}?limit=1&fields=Exercise`);
		expect(first.body.rows).toEqual([
			expect.objectContaining({ id: squat, fields: { Exercise: 'Squat' } })
		]);
		expect(first.body.cursor).toEqual(expect.any(String));
		const second = await call('GET', `${path}?limit=1&fields=Exercise&cursor=${first.body.cursor}`);
		expect(second.body).toEqual({
			rows: [expect.objectContaining({ id: bench, fields: { Exercise: 'Bench' } })],
			cursor: null
		});
		const byId = await call('GET', `${path}?keys=id&fields=Weight&fields=Muscle`);
		expect(Object.keys(byId.body.rows[0].fields)).toHaveLength(2);
		expect(Object.keys(byId.body.rows[0].fields)).not.toContain('Weight');
		expect((await call('GET', `${path}?fields=Reps`)).status).toBe(404);
	});

	it('reads a computed field as SQLite computes it', async () => {
		const made = await execute(
			db,
			{ userId, tokenId: 'setup' },
			toolNamed('add_field') as Tool,
			{ base: 'Training', table: 'Sets', name: 'Double', type: 'formula', formula: '"Weight" * 2' },
			'mcp'
		);
		expect(made.outcome.ok).toBe(true);
		const rows = await call('GET', '/api/v1/bases/Training/tables/Sets/rows?fields=Double');
		expect(rows.body.rows.map((row: { fields: unknown }) => row.fields)).toEqual([
			{ Double: 200 },
			{ Double: 160 }
		]);
	});

	it('changes rows, one or many, and reads one back', async () => {
		const path = '/api/v1/bases/Training/tables/Sets/rows';
		const many = await call('PATCH', path, {
			body: { updates: [{ id: squat, values: { Weight: 110 } }] }
		});
		expect(many.status).toBe(200);
		expect(many.body.rows[0].fields).toMatchObject({ Weight: 110, Double: 220 });
		const one = await call('PATCH', `${path}/${bench}`, { body: { Done: true } });
		expect(one.body.fields).toMatchObject({ Exercise: 'Bench', Done: true });
		expect((await call('GET', `${path}/${bench}?keys=name`)).body.fields.Done).toBe(true);
		expect((await call('GET', `${path}/nope`)).status).toBe(404);
		expect((await call('PATCH', `${path}/nope`, { body: { Done: true } })).status).toBe(404);
		expect(
			(await call('PATCH', path, { body: { updates: [{ id: 'nope', values: {} }] } })).status
		).toBe(422);
	});

	it('reads with SQL', async () => {
		const answer = await call('POST', '/api/v1/bases/Training/query', {
			body: { sql: 'select "Exercise", "Weight" from "Sets" order by "Weight" desc' }
		});
		expect(answer.body).toMatchObject({
			columns: ['Exercise', 'Weight'],
			rows: [
				['Squat', 110],
				['Bench', 80]
			]
		});
		const refused = await call('POST', '/api/v1/bases/Training/query', {
			body: { sql: 'delete from "Sets"' }
		});
		expect(refused.status).toBe(422);
	});

	it('leaves a read token the reads and query, and refuses it every write', async () => {
		const path = '/api/v1/bases/Training/tables/Sets/rows';
		expect((await call('GET', path, { token: reader })).status).toBe(200);
		expect(
			(
				await call('POST', '/api/v1/bases/Training/query', {
					token: reader,
					body: { sql: 'select 1' }
				})
			).status
		).toBe(200);
		const refused = await call('POST', path, { token: reader, body: { rows: [{}] } });
		expect(refused.status).toBe(403);
		expect(refused.body.error.code).toBe('forbidden');
		expect((await call('DELETE', `${path}/${squat}`, { token: reader })).status).toBe(403);
	});

	it('keeps a table fed by a source closed to new rows, as the app does', async () => {
		const refused = await call('POST', '/api/v1/bases/Training/tables/Feed/rows', {
			body: { rows: [{ Title: 'Mine' }] }
		});
		expect(refused.status).toBe(422);
		expect(refused.body.error.message).toContain('source');
	});

	it('feeds the changes of one base from a cursor, deletions included', async () => {
		const start = await call('GET', '/api/v1/changes?base=Training');
		expect(start.status).toBe(200);
		expect(start.body.more).toBe(false);
		const rows = start.body.changes.filter((change: { kind: string }) => change.kind === 'row');
		expect(rows.map((change: { id: string }) => change.id)).toEqual([squat, bench]);
		expect(rows[0].row.fields.Weight).toBe(110);
		expect(start.body.changes.some((change: { kind: string }) => change.kind === 'field')).toBe(
			true
		);

		const quiet = await call('GET', `/api/v1/changes?base=Training&since=${start.body.cursor}`);
		expect(quiet.body).toEqual({ changes: [], cursor: start.body.cursor, more: false });

		expect((await call('DELETE', `/api/v1/bases/Training/tables/Sets/rows/${squat}`)).body).toEqual(
			{ deleted: 1 }
		);
		const after = await call('GET', `/api/v1/changes?base=Training&since=${start.body.cursor}`);
		expect(after.body.changes).toEqual([
			{ kind: 'row', id: squat, table: rows[0].table, deleted: true }
		]);

		const paged = await call('GET', '/api/v1/changes?base=Training&limit=1');
		expect(paged.body.more).toBe(true);

		expect(
			(await call('GET', `/api/v1/changes?base=Money&since=${start.body.cursor}`)).status
		).toBe(400);
		expect((await call('GET', '/api/v1/changes')).status).toBe(400);
		expect((await call('GET', '/api/v1/changes?base=Nope')).status).toBe(404);
	});

	it('deletes rows by id', async () => {
		const path = '/api/v1/bases/Training/tables/Sets/rows';
		const added = await call('POST', path, {
			body: { rows: [{ Exercise: 'A' }, { Exercise: 'B' }] }
		});
		const ids = added.body.rows.map((row: { id: string }) => row.id);
		const deleted = await call('DELETE', `${path}?ids=${ids[0]}&ids=${ids[1]}`);
		expect(deleted.body).toEqual({ deleted: 2 });
		expect((await call('DELETE', `${path}?ids=${ids[0]}`)).status).toBe(422);
		expect((await call('DELETE', `${path}/${bench}`)).body).toEqual({ deleted: 1 });
		expect((await call('GET', path)).body.rows).toEqual([]);
	});

	it('answers 429 with Retry-After past the token budget', async () => {
		vi.stubEnv('TORSEL_API_CALLS_PER_MINUTE', '2');
		await call('GET', '/api/v1/bases');
		await call('GET', '/api/v1/bases');
		const refused = await call('GET', '/api/v1/bases');
		expect(refused.status).toBe(429);
		expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
		expect((await call('GET', '/api/v1/bases', { token: reader })).status).toBe(200);
	});

	it('exercised every operation and every documented status', () => {
		const documented = Object.entries(doc.paths).flatMap(([path, methods]) =>
			Object.entries(methods).flatMap(([method, operation]) =>
				Object.keys(operation.responses).map((status) => `${method} ${path} ${status}`)
			)
		);
		const successes = documented.filter((key) => / 20\d$/u.test(key));
		expect(successes.filter((key) => !seen.has(key))).toEqual([]);
		const statuses = new Set([...seen].map((key) => key.split(' ')[2]));
		expect([...statuses].sort()).toEqual(['200', '201', '400', '401', '403', '404', '422', '429']);
	});
});
