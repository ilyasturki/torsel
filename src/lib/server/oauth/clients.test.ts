import type { Server } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '../db/client.ts';
import { createDatabase } from '../db/client.ts';
import { runMigrations } from '../db/migrate.ts';
import {
	forgetDocuments,
	freshness,
	metadataUrl,
	readDocument,
	registerClient,
	resolveClient
} from './clients.ts';

const ORIGIN = 'https://torsel.test';

type Served = { status?: number; body?: string; headers?: Record<string, string> };
let routes: Record<string, Served> = {};
let hits: string[] = [];
let server: Server;
let base: string;

beforeAll(async () => {
	server = createServer((request, response) => {
		const path = request.url ?? '/';
		hits.push(path);
		const served = routes[path] ?? { status: 404, body: '' };
		response.writeHead(served.status ?? 200, {
			'content-type': 'application/json',
			...served.headers
		});
		response.end(served.body ?? '');
	});
	await new Promise<void>((settle) => server.listen(0, '127.0.0.1', settle));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
	server.close();
});

let db: Database;

beforeEach(() => {
	db = createDatabase(':memory:');
	runMigrations(db);
	routes = {};
	hits = [];
	forgetDocuments();
	vi.stubEnv('TORSEL_FETCH_PRIVATE', '1');
});

afterEach(() => {
	vi.unstubAllEnvs();
});

function document(path: string, fields: Record<string, unknown> = {}): string {
	return JSON.stringify({
		client_id: `${base}${path}`,
		client_name: 'Claude Code',
		redirect_uris: ['http://localhost/callback'],
		grant_types: ['authorization_code', 'refresh_token'],
		response_types: ['code'],
		token_endpoint_auth_method: 'none',
		...fields
	});
}

describe('a client id metadata URL', () => {
	it('is an https URL with a path, in its normal form, not this server', () => {
		vi.stubEnv('TORSEL_FETCH_PRIVATE', '');
		expect(metadataUrl('https://claude.ai/oauth/claude-code-client-metadata', ORIGIN)?.host).toBe(
			'claude.ai'
		);
		for (const id of [
			'http://agent.example/client.json',
			'https://agent.example/',
			'https://agent.example',
			'https://agent.example/a/../client.json',
			'https://Agent.example/client.json',
			'https://agent.example:443/client.json',
			'https://agent.example/client.json#x',
			'https://user:pw@agent.example/client.json',
			`${ORIGIN}/client.json`,
			'http://127.0.0.1:9/client.json',
			`https://agent.example/${'x'.repeat(2000)}`
		]) {
			expect(metadataUrl(id, ORIGIN), id).toBeNull();
		}
	});

	it('may be plain http on loopback only when private fetches are allowed', () => {
		expect(metadataUrl('http://127.0.0.1:9/client.json', ORIGIN)).not.toBeNull();
		expect(metadataUrl('http://agent.example/client.json', ORIGIN)).toBeNull();
	});
});

describe('a client id metadata document', () => {
	const id = 'https://agent.example/client.json';
	const valid = {
		client_id: id,
		client_name: 'Agent',
		redirect_uris: ['https://agent.example/cb']
	};

	it('names the client and where it may return, vouched for by its host', () => {
		expect(readDocument(JSON.stringify(valid), id)).toEqual({
			id,
			name: 'Agent',
			host: 'agent.example',
			redirectUris: ['https://agent.example/cb']
		});
	});

	it('must carry the URL it was fetched from as its client_id', () => {
		expect(
			readDocument(JSON.stringify({ ...valid, client_id: 'https://evil.example/c' }), id)
		).toBe(null);
	});

	it('is a public client: no secret method', () => {
		for (const method of ['client_secret_basic', 'client_secret_post', 'private_key_jwt']) {
			expect(
				readDocument(JSON.stringify({ ...valid, token_endpoint_auth_method: method }), id)
			).toBeNull();
		}
	});

	it('needs valid redirect URIs and the code grant', () => {
		expect(readDocument(JSON.stringify({ ...valid, redirect_uris: [] }), id)).toBeNull();
		expect(
			readDocument(JSON.stringify({ ...valid, redirect_uris: ['http://agent.example/cb'] }), id)
		).toBeNull();
		expect(readDocument(JSON.stringify({ ...valid, grant_types: ['implicit'] }), id)).toBeNull();
		expect(readDocument(JSON.stringify({ ...valid, response_types: ['token'] }), id)).toBeNull();
		expect(readDocument('not json', id)).toBeNull();
	});

	it('shows a cleaned, bounded name, or the host without one', () => {
		const named = (client_name: unknown) =>
			readDocument(JSON.stringify({ ...valid, client_name }), id)?.name;
		expect(named('  Agent‮ evil  ')).toBe('Agent evil');
		expect(named('x'.repeat(200))).toHaveLength(80);
		expect(named(undefined)).toBe('agent.example');
		expect(named(42)).toBe('agent.example');
	});
});

describe('fetching a metadata document', () => {
	it('resolves the client from its document', async () => {
		routes['/claude.json'] = { body: document('/claude.json') };
		const lookup = await resolveClient(db, `${base}/claude.json`, ORIGIN);
		expect(lookup).toEqual({
			ok: true,
			client: {
				id: `${base}/claude.json`,
				name: 'Claude Code',
				host: new URL(base).host,
				redirectUris: ['http://localhost/callback']
			}
		});
	});

	it('fails without redirecting on a missing document, and says when the client is down', async () => {
		expect(await resolveClient(db, `${base}/missing.json`, ORIGIN)).toEqual({
			ok: false,
			unreachable: false
		});
		routes['/down.json'] = { status: 503 };
		expect(await resolveClient(db, `${base}/down.json`, ORIGIN)).toEqual({
			ok: false,
			unreachable: true
		});
	});

	it('follows no redirect', async () => {
		routes['/moved.json'] = { status: 302, headers: { location: `${base}/claude.json` } };
		routes['/claude.json'] = { body: document('/claude.json') };
		expect((await resolveClient(db, `${base}/moved.json`, ORIGIN)).ok).toBe(false);
		expect(hits).toEqual(['/moved.json']);
	});

	it('reads at most 5 KB', async () => {
		routes['/big.json'] = { body: document('/big.json', { padding: 'x'.repeat(6000) }) };
		expect((await resolveClient(db, `${base}/big.json`, ORIGIN)).ok).toBe(false);
	});

	it('caches a good document within its Cache-Control, never a failure', async () => {
		routes['/claude.json'] = {
			body: document('/claude.json'),
			headers: { 'cache-control': 'max-age=60' }
		};
		await resolveClient(db, `${base}/claude.json`, ORIGIN);
		await resolveClient(db, `${base}/claude.json`, ORIGIN);
		expect(hits).toEqual(['/claude.json']);

		routes['/fixed.json'] = { status: 500 };
		await resolveClient(db, `${base}/fixed.json`, ORIGIN);
		routes['/fixed.json'] = { body: document('/fixed.json') };
		expect((await resolveClient(db, `${base}/fixed.json`, ORIGIN)).ok).toBe(true);

		routes['/fresh.json'] = {
			body: document('/fresh.json'),
			headers: { 'cache-control': 'no-store' }
		};
		await resolveClient(db, `${base}/fresh.json`, ORIGIN);
		await resolveClient(db, `${base}/fresh.json`, ORIGIN);
		expect(hits.filter((path) => path === '/fresh.json')).toHaveLength(2);
	});

	it('goes through the SSRF guard: no loopback without the private switch', async () => {
		vi.stubEnv('TORSEL_FETCH_PRIVATE', '');
		routes['/claude.json'] = { body: document('/claude.json') };
		expect((await resolveClient(db, `${base}/claude.json`, ORIGIN)).ok).toBe(false);
		expect(hits).toEqual([]);
	});

	it('reads freshness from Cache-Control, bounded to a day', () => {
		expect(freshness(undefined)).toBe(300);
		expect(freshness('max-age=120')).toBe(120);
		expect(freshness('public, max-age=9999999')).toBe(86_400);
		expect(freshness('no-cache')).toBe(0);
		expect(freshness('max-age=60, no-store')).toBe(0);
	});
});

describe('dynamic registration', () => {
	it('registers a public client whatever method it asked for', async () => {
		const registration = registerClient(db, {
			client_name: 'Gemini CLI',
			redirect_uris: ['http://localhost:7777/oauth/callback'],
			token_endpoint_auth_method: 'client_secret_basic'
		});
		expect(registration.ok).toBe(true);
		if (!registration.ok) return;
		expect(registration.metadata).toMatchObject({
			client_name: 'Gemini CLI',
			token_endpoint_auth_method: 'none',
			grant_types: ['authorization_code', 'refresh_token']
		});
		expect(registration.metadata).not.toHaveProperty('client_secret');
		const id = String(registration.metadata.client_id);
		expect(await resolveClient(db, id, ORIGIN)).toMatchObject({
			ok: true,
			client: { name: 'Gemini CLI', host: null }
		});
	});

	it('refuses redirect URIs that are not https or loopback', () => {
		for (const redirect_uris of [
			undefined,
			[],
			['http://agent.example/cb'],
			['https://agent.example/cb#x'],
			['custom:callback'],
			Array.from({ length: 11 }, (_, index) => `https://agent.example/${index}`)
		]) {
			const registration = registerClient(db, { redirect_uris });
			expect(registration.ok).toBe(false);
			expect(!registration.ok && registration.error).toBe('invalid_redirect_uri');
		}
	});

	it('refuses a client that wants another grant', () => {
		const registration = registerClient(db, {
			redirect_uris: ['https://agent.example/cb'],
			grant_types: ['client_credentials']
		});
		expect(!registration.ok && registration.error).toBe('invalid_client_metadata');
	});
});
