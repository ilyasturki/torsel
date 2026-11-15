import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { RequestEvent } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';

import { createUser, issueToken } from '../auth/accounts.ts';
import type { AuthToken } from '../db/schema.ts';
import { createDatabase } from '../db/client.ts';
import { runMigrations } from '../db/migrate.ts';
import { createHandle } from './handle.ts';
import { PUBLIC_API_ROUTES } from './public-routes.ts';

const ROOT = 'src/routes/api';

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
			request: new Request(url, { method: 'POST', headers: { authorization: `Bearer ${token}` } }),
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

	it('leaves a device token the whole API', async () => {
		const statuses = await reach('device');

		expect([...statuses].filter(([, status]) => status !== 200)).toEqual([]);
	});
});
