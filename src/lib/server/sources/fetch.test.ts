import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { GuardedRequest } from '../net/guard.ts';
import { guardedFetch } from '../net/guard.ts';
import type { Caps, PullRequest } from './fetch.ts';
import { PullFailed, linkNext, pull, redact } from './fetch.ts';

const CAPS: Caps = { pages: 5, rows: 100, ms: 5000, pageBytes: 100_000 };

type Seen = { host: string; path: string; authorization?: string; key?: string };

let seen: Seen[] = [];
let main: { server: Server; base: string };
let other: { server: Server; base: string };

function listen(route: (request: IncomingMessage, response: ServerResponse) => void) {
	const server = createServer(route);
	return new Promise<{ server: Server; base: string }>((settle) => {
		server.listen(0, '127.0.0.1', () => {
			settle({ server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
		});
	});
}

function json(response: ServerResponse, body: unknown, headers: Record<string, string> = {}) {
	response.writeHead(200, { 'content-type': 'application/json', ...headers });
	response.end(JSON.stringify(body));
}

beforeAll(async () => {
	other = await listen((request, response) => {
		const url = new URL(request.url ?? '/', 'http://other');
		seen.push({
			host: 'other',
			path: url.pathname,
			authorization: request.headers.authorization,
			key:
				(request.headers['x-api-key'] as string | undefined) ??
				url.searchParams.get('key') ??
				undefined
		});
		json(response, [{ id: 'elsewhere' }]);
	});
	main = await listen((request, response) => {
		const url = new URL(request.url ?? '/', 'http://main');
		seen.push({
			host: 'main',
			path: url.pathname + url.search.replace(/[?&]key=[^&]*/u, ''),
			authorization: request.headers.authorization,
			key:
				(request.headers['x-api-key'] as string | undefined) ??
				url.searchParams.get('key') ??
				undefined
		});
		const page = Number(url.searchParams.get('page') ?? '1');
		switch (url.pathname) {
			case '/link':
				return json(
					response,
					[{ id: `l${page}` }],
					page < 3
						? { link: `<${main.base}/link?page=${page + 1}>; rel="next", <x>; rel="last"` }
						: {}
				);
			case '/body':
				return json(response, {
					items: [{ id: `b${page}` }],
					next: page < 2 ? `/body?page=${page + 1}` : null
				});
			case '/loop':
				return json(response, [{ id: 'x' }], { link: `<${main.base}/loop>; rel=next` });
			case '/away':
				response.writeHead(302, { location: `${other.base}/landed?key=theirs` });
				return response.end();
			case '/again':
				response.writeHead(301, { location: '/link' });
				return response.end();
			case '/circle':
				response.writeHead(302, { location: '/circle' });
				return response.end();
			case '/private-next':
				return json(response, [{ id: 'p' }], { link: '<http://127.0.0.1:9/x>; rel="next"' });
			case '/denied':
				response.writeHead(401);
				return response.end();
			case '/gone':
				response.writeHead(404);
				return response.end();
			case '/busy':
				response.writeHead(429, { 'retry-after': '120' });
				return response.end();
			case '/broken':
				response.writeHead(500);
				return response.end();
			case '/docs':
				response.writeHead(200, { 'content-type': 'text/html' });
				return response.end('<html><body>API docs</body></html>');
			default:
				return json(response, [{ id: 'one' }, { id: 'two' }]);
		}
	});
	process.env.TORSEL_FETCH_PRIVATE = '1';
});

afterAll(() => {
	delete process.env.TORSEL_FETCH_PRIVATE;
	main.server.close();
	other.server.close();
});

const request = (path: string, extra: Partial<PullRequest> = {}): PullRequest => ({
	url: `${main.base}${path}`,
	auth: { kind: 'none', name: null },
	secret: null,
	rows: null,
	...extra
});

async function problem(promise: Promise<unknown>): Promise<string> {
	try {
		await promise;
	} catch (error) {
		if (error instanceof PullFailed) return error.problem;
		throw error;
	}
	return 'pulled';
}

describe('pull', () => {
	it('follows Link headers and next URLs in the body, page by page', async () => {
		const linked = await pull(request('/link'), CAPS);
		expect(linked.items.map((item) => item.id)).toEqual(['l1', 'l2', 'l3']);
		expect(linked).toMatchObject({ pages: 3, complete: true, format: 'json' });

		const bodied = await pull(request('/body'), CAPS);
		expect(bodied.items.map((item) => item.id)).toEqual(['b1', 'b2']);
		expect(bodied.rows).toBe('items');
	});

	it('stops at a page it has read, and at the caps, saying the pull is not complete', async () => {
		expect(await pull(request('/loop'), CAPS)).toMatchObject({ pages: 1, complete: true });
		const paged = await pull(request('/link'), { ...CAPS, pages: 2 });
		expect(paged).toMatchObject({ pages: 2, complete: false });
		const rowed = await pull(request('/'), { ...CAPS, rows: 1 });
		expect(rowed.items).toEqual([{ id: 'one' }]);
		expect(rowed.complete).toBe(false);
	});

	it('signs each kind of auth, for its own origin only', async () => {
		seen = [];
		await pull(request('/', { auth: { kind: 'bearer', name: null }, secret: 's3cret' }), CAPS);
		await pull(request('/', { auth: { kind: 'basic', name: null }, secret: 'me:pw' }), CAPS);
		await pull(request('/', { auth: { kind: 'header', name: 'X-Api-Key' }, secret: 'hk' }), CAPS);
		await pull(request('/', { auth: { kind: 'query', name: 'key' }, secret: 'qk' }), CAPS);
		expect(seen.map(({ authorization, key }) => [authorization, key])).toEqual([
			['Bearer s3cret', undefined],
			[`Basic ${Buffer.from('me:pw').toString('base64')}`, undefined],
			[undefined, 'hk'],
			[undefined, 'qk']
		]);
	});

	it('keeps every key off a redirect to another origin', async () => {
		for (const [kind, name] of [
			['bearer', null],
			['header', 'X-Api-Key'],
			['query', 'key']
		] as const) {
			seen = [];
			const pulled = await pull(request('/away', { auth: { kind, name }, secret: 'k' }), CAPS);
			expect(pulled.items).toEqual([{ id: 'elsewhere' }]);
			// The redirect names a `key` of its own; a query key of ours by that name is dropped with it.
			expect(seen.at(-1)).toEqual({
				host: 'other',
				path: '/landed',
				authorization: undefined,
				key: kind === 'query' ? undefined : 'theirs'
			});
		}
	});

	it('follows a redirect on its origin with the key, and gives up on a circle', async () => {
		seen = [];
		const pulled = await pull(
			request('/again', { auth: { kind: 'bearer', name: null }, secret: 'k' }),
			CAPS
		);
		expect(pulled.pages).toBe(3);
		expect(seen.every((hit) => hit.authorization === 'Bearer k')).toBe(true);
		expect(await problem(pull(request('/circle'), CAPS))).toBe('redirects');
	});

	it('names what went wrong', async () => {
		expect(await problem(pull(request('/denied'), CAPS))).toBe('auth');
		expect(await problem(pull(request('/gone'), CAPS))).toBe('missing');
		expect(await problem(pull(request('/broken'), CAPS))).toBe('status');
		expect(await problem(pull(request('/docs'), CAPS))).toBe('html');
		expect(await problem(pull({ ...request('/'), url: 'not a url' }, CAPS))).toBe('scheme');
		expect(await problem(pull({ ...request('/'), url: 'file:///etc/passwd' }, CAPS))).toBe(
			'scheme'
		);
		try {
			await pull(request('/busy'), CAPS);
		} catch (error) {
			expect(error).toMatchObject({ problem: 'limit', retryAfterMs: 120_000 });
		}
	});
});

describe('the guard on every hop', () => {
	// Stands in for a public origin: the first request may reach the test server, no later one may.
	function firstOnly() {
		let calls = 0;
		return (target: string | URL, options: GuardedRequest) => {
			calls += 1;
			return guardedFetch(target, { ...options, allowPrivate: calls === 1 });
		};
	}

	it('refuses a private address unless the server allows them', async () => {
		delete process.env.TORSEL_FETCH_PRIVATE;
		try {
			expect(await problem(pull(request('/'), CAPS))).toBe('address');
			expect(await problem(pull({ ...request('/'), url: 'http://[::1]:9/' }, CAPS))).toBe(
				'address'
			);
		} finally {
			process.env.TORSEL_FETCH_PRIVATE = '1';
		}
	});

	it('refuses a redirect to a private address', async () => {
		expect(await problem(pull(request('/again'), CAPS, firstOnly()))).toBe('address');
	});

	it('refuses a next page on a private address', async () => {
		expect(await problem(pull(request('/private-next'), CAPS, firstOnly()))).toBe('address');
	});
});

describe('linkNext and redact', () => {
	it('reads the next page out of a Link header', () => {
		expect(linkNext('<https://a/2>; rel="next", <https://a/9>; rel="last"')).toBe('https://a/2');
		expect(linkNext('<https://a/1>; rel="prev", <https://a/3>; rel=next')).toBe('https://a/3');
		expect(linkNext('<https://a/1>; rel="prev"')).toBeNull();
		expect(linkNext(undefined)).toBeNull();
	});

	it('takes a query key out of a URL', () => {
		const auth = { kind: 'query', name: 'api_key' } as const;
		expect(redact('https://a.example/x?api_key=s&page=2', auth)).toBe('https://a.example/x?page=2');
		expect(redact('https://a.example/x?api_key=s', { kind: 'none', name: null })).toContain(
			'api_key'
		);
	});
});
