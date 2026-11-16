import { createHash } from 'node:crypto';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MAX_IMAGE_BYTES } from '../../core/images.ts';
import { insertUser } from '../auth/accounts.ts';
import { createDatabase } from '../db/client.ts';
import { runMigrations } from '../db/migrate.ts';
import { IngestFailed, ingestAll, ingestImage } from './ingest.ts';
import { readImage } from './store.ts';

function png(w: number, h: number): Buffer {
	const head = Buffer.alloc(64);
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head);
	head.writeUInt32BE(13, 8);
	head.write('IHDR', 12, 'latin1');
	head.writeUInt32BE(w, 16);
	head.writeUInt32BE(h, 20);
	return head;
}

const POSTER = png(342, 513);

let server: Server;
let origin: string;
let hits: string[] = [];

beforeAll(async () => {
	server = createServer((request, response) => {
		const path = request.url ?? '/';
		hits.push(path);
		switch (path) {
			case '/posters/dune%20part%20two.png':
			case '/poster':
				response.writeHead(200, { 'content-type': 'image/png' });
				response.end(POSTER);
				return;
			case '/moved':
				response.writeHead(302, { location: '/poster' });
				response.end();
				return;
			case '/page':
				response.writeHead(200, { 'content-type': 'image/png' });
				response.end('<!doctype html><script>alert(1)</script>');
				return;
			case '/svg':
				response.writeHead(200, { 'content-type': 'image/svg+xml' });
				response.end('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
				return;
			case '/huge':
				response.writeHead(200, { 'content-type': 'image/png' });
				response.end(Buffer.concat([POSTER, Buffer.alloc(MAX_IMAGE_BYTES)]));
				return;
			case '/bomb':
				response.writeHead(200, { 'content-type': 'image/png' });
				response.end(png(20_000, 20_000));
				return;
			default:
				response.writeHead(404);
				response.end();
		}
	});
	await new Promise<void>((settle) => server.listen(0, '127.0.0.1', settle));
	origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
	server.close();
});

function setup() {
	const db = createDatabase(':memory:');
	runMigrations(db);
	const user = insertUser(db, { email: `${crypto.randomUUID()}@example.com` }).id;
	return { db, user };
}

async function problem(promise: Promise<unknown>): Promise<string> {
	try {
		await promise;
	} catch (error) {
		if (error instanceof IngestFailed) return error.problem;
		throw error;
	}
	return 'fetched';
}

describe('ingestImage: what it never reaches', () => {
	const port = () => new URL(origin).port;

	it.each([
		['loopback', () => `${origin}/poster`],
		['a name for loopback', () => `http://localhost:${port()}/poster`],
		['the metadata address', () => 'http://169.254.169.254/latest/meta-data/'],
		['a private range', () => 'http://10.0.0.1/poster.png'],
		['an IPv4-mapped loopback', () => `http://[::ffff:127.0.0.1]:${port()}/poster`],
		['a decimal loopback', () => `http://2130706433:${port()}/poster`],
		['IPv6 loopback', () => `http://[::1]:${port()}/poster`]
	])('refuses %s', async (_, url) => {
		const { db, user } = setup();
		hits = [];
		expect(await problem(ingestImage(db, user, 'b_home', url(), { allowPrivate: false }))).toBe(
			'address'
		);
		expect(hits).toEqual([]);
	});

	it.each([
		'file:///etc/passwd',
		'ftp://example.com/poster.png',
		'javascript:alert(1)',
		'data:image/png;base64,AAAA',
		'https://user:secret@example.com/poster.png',
		'not a link'
	])('refuses %s before any request', async (url) => {
		const { db, user } = setup();
		expect(await problem(ingestImage(db, user, 'b_home', url, { allowPrivate: false }))).toBe(
			'scheme'
		);
	});
});

describe('ingestImage: what it stores', () => {
	const open = { allowPrivate: true };

	it('stores the image under the hash of its bytes, with where it came from', async () => {
		const { db, user } = setup();
		const url = `${origin}/posters/dune%20part%20two.png`;

		const ref = await ingestImage(db, user, 'b_home', url, open);

		const id = createHash('sha256').update(POSTER).digest('hex');
		expect(ref).toEqual({
			id,
			type: 'image/png',
			w: 342,
			h: 513,
			size: POSTER.length,
			name: 'dune part two.png',
			src: url
		});
		expect(readImage(db, user, 'b_home', id)?.data.equals(POSTER)).toBe(true);
	});

	it('follows a redirect, and stores the same bytes once', async () => {
		const { db, user } = setup();
		const first = await ingestImage(db, user, 'b_home', `${origin}/poster`, open);
		const moved = await ingestImage(db, user, 'b_home', `${origin}/moved`, open);
		expect(moved.id).toBe(first.id);
		expect(moved.src).toBe(`${origin}/moved`);
		expect(moved.name).toBeUndefined();
	});

	it('refuses what is not an image, whatever its header says', async () => {
		const { db, user } = setup();
		expect(await problem(ingestImage(db, user, 'b_home', `${origin}/page`, open))).toBe(
			'not-an-image'
		);
		expect(await problem(ingestImage(db, user, 'b_home', `${origin}/svg`, open))).toBe(
			'not-an-image'
		);
	});

	it('refuses a missing page, an oversize body and too many pixels', async () => {
		const { db, user } = setup();
		expect(await problem(ingestImage(db, user, 'b_home', `${origin}/gone`, open))).toBe('status');
		expect(await problem(ingestImage(db, user, 'b_home', `${origin}/huge`, open))).toBe('size');
		expect(await problem(ingestImage(db, user, 'b_home', `${origin}/bomb`, open))).toBe(
			'too-many-pixels'
		);
	});

	it('refuses an image past the account’s storage', async () => {
		const { db, user } = setup();
		expect(
			await problem(
				ingestImage(db, user, 'b_home', `${origin}/poster`, { ...open, limit: POSTER.length - 1 })
			)
		).toBe('full');
	});
});

describe('ingestAll', () => {
	it('fetches each URL once and keeps each failure apart', async () => {
		const { db, user } = setup();
		hits = [];
		const results = await ingestAll(
			[`${origin}/poster`, `${origin}/gone`, `${origin}/poster`],
			(url) => ingestImage(db, user, 'b_home', url, { allowPrivate: true })
		);
		expect(hits.filter((path) => path === '/poster')).toHaveLength(1);
		expect(results.get(`${origin}/poster`)).toMatchObject({ w: 342, h: 513 });
		expect(results.get(`${origin}/gone`)).toBeInstanceOf(IngestFailed);
	});
});
