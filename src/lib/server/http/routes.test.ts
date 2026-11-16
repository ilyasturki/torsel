import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { RequestEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createUser, issueToken } from '../auth/accounts.ts';
import type { AuthToken } from '../db/schema.ts';
import { authTokens } from '../db/schema.ts';
import { createDatabase } from '../db/client.ts';
import { runMigrations } from '../db/migrate.ts';
import { createHandle, crossSiteForm } from './handle.ts';
import { PUBLIC_API_ROUTES } from './public-routes.ts';

const ROOT = 'src/routes/api';

// A POST with no content type counts as a form: these knock as an MCP client would.
const JSON_BODY = { 'content-type': 'application/json' };

function endpoints(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return endpoints(path);
		return entry.name === '+server.ts' ? [path] : [];
	});
}

const routes = endpoints(ROOT).map((file) => ({
	path: `/api${file.slice(ROOT.length, -'/+server.ts'.length)}`,
	source: readFileSync(file, 'utf8')
}));

const guarded = (source: string) => source.includes('requireCredential(');

describe('api routes', () => {
	it('found the API surface', () => {
		expect(routes.length).toBeGreaterThan(10);
	});

	it('are each guarded or declared public', () => {
		const unclassified = routes
			.filter(({ path, source }) => !guarded(source) && !(path in PUBLIC_API_ROUTES))
			.map(({ path }) => path);

		expect(unclassified).toEqual([]);
	});

	it('are never both guarded and public', () => {
		const contradictory = routes
			.filter(({ path, source }) => guarded(source) && path in PUBLIC_API_ROUTES)
			.map(({ path }) => path);

		expect(contradictory).toEqual([]);
	});

	it('leave no stale entry on the allowlist', () => {
		const known = new Set(routes.map(({ path }) => path));

		expect(Object.keys(PUBLIC_API_ROUTES).filter((path) => !known.has(path))).toEqual([]);
	});
});

async function reach(kind: AuthToken['kind']): Promise<Map<string, number>> {
	const db = createDatabase(':memory:');
	runMigrations(db);
	const user = await createUser(db, 'me@example.com', 'correct horse');
	const { token } = issueToken(db, user.id, 'agent', kind);
	const handle = createHandle(() => db);

	const statuses = new Map<string, number>();
	for (const { path } of routes) {
		const url = new URL(path.replaceAll(/\[[^\]]+\]/gu, 'x'), 'http://torsel.test');
		const event = {
			url,
			request: new Request(url, {
				method: 'POST',
				headers: { authorization: `Bearer ${token}`, ...JSON_BODY }
			}),
			route: { id: path },
			cookies: { get: () => undefined },
			locals: {}
		} as unknown as RequestEvent;
		const response = await handle({ event, resolve: async () => new Response('reached') });
		statuses.set(path, response.status);
	}
	return statuses;
}

describe('an api token', () => {
	it('reaches the MCP endpoint and nothing else', async () => {
		const statuses = await reach('api');

		expect(statuses.get('/api/mcp')).toBe(200);
		expect([...statuses].filter(([path, status]) => path !== '/api/mcp' && status !== 403)).toEqual(
			[]
		);
	});

	it('reaches nothing outside MCP as an OAuth token', async () => {
		const statuses = await reach('oauth');

		expect([...statuses].filter(([path, status]) => path !== '/api/mcp' && status !== 403)).toEqual(
			[]
		);
	});

	it('leaves a device token the whole API', async () => {
		const statuses = await reach('device');

		expect([...statuses].filter(([, status]) => status !== 200)).toEqual([]);
	});
});

async function knock(
	path: string,
	secret: string | null,
	db = createDatabase(':memory:')
): Promise<Response> {
	const url = new URL(path, 'http://torsel.test');
	const headers: Record<string, string> =
		secret === null ? JSON_BODY : { authorization: `Bearer ${secret}`, ...JSON_BODY };
	const event = {
		url,
		request: new Request(url, { method: 'POST', headers }),
		route: { id: path },
		cookies: { get: () => undefined },
		locals: {}
	} as unknown as RequestEvent;
	return createHandle(() => db)({ event, resolve: async () => new Response('reached') });
}

describe('the MCP endpoint', () => {
	it('challenges a request without a valid token', async () => {
		const db = createDatabase(':memory:');
		runMigrations(db);

		const bare = await knock('/api/mcp', null, db);
		expect(bare.status).toBe(401);
		expect(bare.headers.get('www-authenticate')).toBe('Bearer realm="torsel"');

		const wrong = await knock('/api/mcp', 'ts_nope', db);
		expect(wrong.headers.get('www-authenticate')).toBe(
			'Bearer realm="torsel", error="invalid_token"'
		);

		expect((await knock('/api/sync', null, db)).headers.has('www-authenticate')).toBe(false);
	});

	it('refuses a token past its expiry', async () => {
		const db = createDatabase(':memory:');
		runMigrations(db);
		const user = await createUser(db, 'me@example.com', 'correct horse');
		const { token } = issueToken(db, user.id, 'agent', 'api', new Date(Date.now() - 1000));

		expect((await knock('/api/mcp', token, db)).status).toBe(401);
	});
});

async function oauthToken(
	db: ReturnType<typeof createDatabase>,
	resource: string
): Promise<string> {
	const user = await createUser(db, `${crypto.randomUUID()}@example.com`, 'correct horse');
	const { token, record } = issueToken(
		db,
		user.id,
		'Agent',
		'oauth',
		new Date(Date.now() + 60_000)
	);
	db.update(authTokens).set({ resource }).where(eq(authTokens.id, record.id)).run();
	return token;
}

async function knockAt(
	base: string,
	path: string,
	db: ReturnType<typeof createDatabase>,
	init: RequestInit = {}
): Promise<Response> {
	const url = new URL(path, base);
	const event = {
		url,
		request: new Request(url, {
			method: 'POST',
			...init,
			headers: { ...JSON_BODY, ...(init.headers as Record<string, string> | undefined) }
		}),
		route: { id: path },
		cookies: { get: () => undefined },
		locals: {}
	} as unknown as RequestEvent;
	return createHandle(() => db)({ event, resolve: async () => new Response('reached') });
}

describe('an OAuth access token', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('reaches the MCP endpoint of its own audience and nothing else', async () => {
		vi.stubEnv('ORIGIN', 'https://torsel.test');
		const db = createDatabase(':memory:');
		runMigrations(db);
		const token = await oauthToken(db, 'https://torsel.test/api/mcp');
		const bearer = { headers: { authorization: `Bearer ${token}` } };

		expect((await knockAt('https://torsel.test', '/api/mcp', db, bearer)).status).toBe(200);
		for (const { path } of routes.filter((route) => route.path !== '/api/mcp')) {
			const concrete = path.replaceAll(/\[[^\]]+\]/gu, 'x');
			const { status } = await knockAt('https://torsel.test', concrete, db, bearer);
			expect([path, status]).toEqual([path, 403]);
		}
	});

	it('is no token for another audience, or once OAuth is off', async () => {
		vi.stubEnv('ORIGIN', 'https://torsel.test');
		const db = createDatabase(':memory:');
		runMigrations(db);
		const other = await oauthToken(db, 'https://elsewhere.example/api/mcp');
		const refused = await knockAt('https://torsel.test', '/api/mcp', db, {
			headers: { authorization: `Bearer ${other}` }
		});
		expect(refused.status).toBe(401);
		expect(refused.headers.get('www-authenticate')).toContain('error="invalid_token"');

		const ours = await oauthToken(db, 'https://torsel.test/api/mcp');
		vi.stubEnv('ORIGIN', 'http://192.168.1.50:3000');
		const off = await knockAt('http://192.168.1.50:3000', '/api/mcp', db, {
			headers: { authorization: `Bearer ${ours}` }
		});
		expect(off.status).toBe(401);
	});
});

describe('the MCP challenge with OAuth on', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('names the resource metadata for clients to sign in', async () => {
		vi.stubEnv('ORIGIN', 'https://torsel.test');
		const db = createDatabase(':memory:');
		runMigrations(db);
		const bare = await knockAt('https://torsel.test', '/api/mcp', db);
		expect(bare.status).toBe(401);
		expect(bare.headers.get('www-authenticate')).toBe(
			'Bearer realm="torsel", resource_metadata="https://torsel.test/.well-known/oauth-protected-resource/api/mcp", scope="read write"'
		);
	});

	it('serves the discovery documents before any route', async () => {
		vi.stubEnv('ORIGIN', 'https://torsel.test');
		const db = createDatabase(':memory:');
		const document = await knockAt(
			'https://torsel.test',
			'/.well-known/oauth-protected-resource/api/mcp',
			db,
			{ method: 'GET' }
		);
		expect(document.status).toBe(200);
		expect(await document.json()).toMatchObject({ resource: 'https://torsel.test/api/mcp' });
	});
});

describe('a cross-site form', () => {
	const form = (origin: string | null): RequestInit => ({
		headers: {
			'content-type': 'application/x-www-form-urlencoded',
			...(origin === null ? {} : { origin })
		},
		body: 'a=1'
	});

	it('is refused everywhere, as SvelteKit would', async () => {
		const db = createDatabase(':memory:');
		runMigrations(db);
		for (const path of ['/api/auth/login', '/api/mcp', '/app/settings']) {
			const foreign = await knockAt('https://torsel.test', path, db, form('https://evil.example'));
			expect(foreign.status).toBe(403);
			expect((await knockAt('https://torsel.test', path, db, form(null))).status).toBe(403);
		}
		const own = await knockAt(
			'https://torsel.test',
			'/api/auth/login',
			db,
			form('https://torsel.test')
		);
		expect(own.status).not.toBe(403);
	});

	it('reaches the token and revocation endpoints, which servers post to', async () => {
		const db = createDatabase(':memory:');
		runMigrations(db);
		for (const path of ['/api/oauth/token', '/api/oauth/revoke']) {
			expect((await knockAt('https://torsel.test', path, db, form(null))).status).toBe(200);
		}
	});

	it('leaves JSON alone, which a browser cannot post across sites without CORS', () => {
		const url = new URL('https://torsel.test/api/mcp');
		const request = new Request(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' }
		});
		expect(crossSiteForm(request, url, '/api/mcp')).toBe(false);
	});
});
