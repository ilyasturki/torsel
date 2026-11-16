import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { GuardedRequest } from './guard.ts';
import { FetchRefused, deniedAddress, guardedFetch } from './guard.ts';

const BUDGET: GuardedRequest = {
	accept: 'application/json',
	timeoutMs: 2000,
	maxBytes: 5000,
	maxRedirects: 0
};

type Route = (request: IncomingMessage, response: ServerResponse) => void;

function listen(route: Route): Promise<{ server: Server; base: string }> {
	const server = createServer(route);
	return new Promise((settle) => {
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address() as AddressInfo;
			settle({ server, base: `http://127.0.0.1:${port}` });
		});
	});
}

async function refusal(promise: Promise<unknown>): Promise<string> {
	try {
		await promise;
	} catch (error) {
		if (error instanceof FetchRefused) return error.reason;
		throw error;
	}
	return 'fetched';
}

let seen: { authorization?: string; ua?: string }[] = [];
let local: { server: Server; base: string };
let other: { server: Server; base: string };

beforeAll(async () => {
	other = await listen((request, response) => {
		seen.push({ authorization: request.headers.authorization });
		response.end('{}');
	});
	local = await listen((request, response) => {
		seen.push({ authorization: request.headers.authorization, ua: request.headers['user-agent'] });
		const { pathname } = new URL(request.url ?? '/', 'http://local');
		if (pathname === '/big') {
			response.end('x'.repeat(6000));
		} else if (pathname === '/bomb') {
			response.writeHead(200, { 'content-encoding': 'gzip' });
			response.end(gzipSync(Buffer.alloc(100_000)));
		} else if (pathname === '/zipped') {
			response.writeHead(200, { 'content-encoding': 'gzip' });
			response.end(gzipSync('{"ok":true}'));
		} else if (pathname === '/away') {
			response.writeHead(302, { location: `${other.base}/landed` });
			response.end();
		} else if (pathname === '/file') {
			response.writeHead(302, { location: 'file:///etc/passwd' });
			response.end();
		} else if (pathname === '/hang') {
			// never answers
		} else {
			response.end('{"ok":true}');
		}
	});
});

afterAll(() => {
	local.server.closeAllConnections();
	local.server.close();
	other.server.close();
});

describe('deniedAddress', () => {
	it.each([
		'127.0.0.1',
		'10.1.2.3',
		'172.20.0.1',
		'192.168.1.10',
		'169.254.169.254',
		'100.64.0.1',
		'0.0.0.0',
		'::1',
		'::',
		'fe80::1',
		'fd00::1',
		'::ffff:127.0.0.1',
		'::ffff:7f00:1',
		'::ffff:169.254.169.254',
		'64:ff9b::7f00:1',
		'[::1]',
		'not an address'
	])('refuses %s', (address) => {
		expect(deniedAddress(address)).toBe(true);
	});

	it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
		'lets %s through',
		(address) => {
			expect(deniedAddress(address)).toBe(false);
		}
	);
});

describe('guardedFetch', () => {
	it('refuses a loopback server, by address and by name', async () => {
		seen = [];
		expect(await refusal(guardedFetch(`${local.base}/`, BUDGET))).toBe('address');
		const port = new URL(local.base).port;
		expect(await refusal(guardedFetch(`http://localhost:${port}/`, BUDGET))).toBe('address');
		expect(await refusal(guardedFetch(`http://[::ffff:127.0.0.1]:${port}/`, BUDGET))).toBe(
			'address'
		);
		expect(await refusal(guardedFetch(`http://2130706433:${port}/`, BUDGET))).toBe('address');
		expect(seen).toEqual([]);
	});

	it('refuses schemes other than http and https, and credentials', async () => {
		expect(await refusal(guardedFetch('file:///etc/passwd', BUDGET))).toBe('scheme');
		expect(await refusal(guardedFetch('ftp://example.com/x', BUDGET))).toBe('scheme');
		expect(await refusal(guardedFetch('https://user:pass@example.com/x', BUDGET))).toBe('scheme');
	});

	it('fetches a private server only when told it may', async () => {
		seen = [];
		const answer = await guardedFetch(`${local.base}/`, { ...BUDGET, allowPrivate: true });
		expect(answer.status).toBe(200);
		expect(answer.body.toString()).toBe('{"ok":true}');
		expect(seen[0].ua).toBe('Torsel');
	});

	it('stops at the size cap, after decompression too', async () => {
		const open = { ...BUDGET, allowPrivate: true };
		expect(await refusal(guardedFetch(`${local.base}/big`, open))).toBe('size');
		expect(await refusal(guardedFetch(`${local.base}/bomb`, open))).toBe('size');
		const zipped = await guardedFetch(`${local.base}/zipped`, open);
		expect(zipped.body.toString()).toBe('{"ok":true}');
	});

	it('stops at the time budget', async () => {
		const open = { ...BUDGET, allowPrivate: true, timeoutMs: 200 };
		expect(await refusal(guardedFetch(`${local.base}/hang`, open))).toBe('timeout');
	});

	it('hands a redirect back unless told to follow it', async () => {
		const answer = await guardedFetch(`${local.base}/away`, { ...BUDGET, allowPrivate: true });
		expect(answer.status).toBe(302);
	});

	it('checks every hop and drops the credential on another origin', async () => {
		seen = [];
		const open = {
			...BUDGET,
			allowPrivate: true,
			maxRedirects: 3,
			headers: { authorization: 'Bearer secret' }
		};
		const answer = await guardedFetch(`${local.base}/away`, open);
		expect(answer.url).toBe(`${other.base}/landed`);
		expect(seen.map(({ authorization }) => authorization)).toEqual(['Bearer secret', undefined]);
		expect(await refusal(guardedFetch(`${local.base}/file`, open))).toBe('scheme');
	});
});
