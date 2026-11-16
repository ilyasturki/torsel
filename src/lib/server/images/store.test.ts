import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { insertUser } from '../auth/accounts.ts';
import { createDatabase } from '../db/client.ts';
import { runMigrations } from '../db/migrate.ts';
import { sniffImage } from './sniff.ts';
import { readImage, receiveImagePart } from './store.ts';

function png(w: number, h: number, extra = 0): Buffer {
	const head = Buffer.alloc(33 + extra);
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head);
	head.writeUInt32BE(13, 8);
	head.write('IHDR', 12, 'latin1');
	head.writeUInt32BE(w, 16);
	head.writeUInt32BE(h, 20);
	return head;
}

function jpeg(w: number, h: number): Buffer {
	const app0 = [0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46];
	const sof = [0xff, 0xc2, 0x00, 0x11, 0x08, h >> 8, h & 0xff, w >> 8, w & 0xff, 0x03];
	return Buffer.from([0xff, 0xd8, ...app0, ...sof, ...Array.from({ length: 12 }, () => 0)]);
}

function webp(chunk: 'VP8 ' | 'VP8L' | 'VP8X', w: number, h: number): Buffer {
	const bytes = Buffer.alloc(40);
	bytes.write('RIFF', 0, 'latin1');
	bytes.write('WEBP', 8, 'latin1');
	bytes.write(chunk, 12, 'latin1');
	if (chunk === 'VP8 ') {
		bytes.set([0x9d, 0x01, 0x2a], 23);
		bytes.writeUInt16LE(w, 26);
		bytes.writeUInt16LE(h, 28);
	} else if (chunk === 'VP8L') {
		bytes[20] = 0x2f;
		bytes.writeUInt32LE(((w - 1) | ((h - 1) << 14)) >>> 0, 21);
	} else {
		bytes.writeUIntLE(w - 1, 24, 3);
		bytes.writeUIntLE(h - 1, 27, 3);
	}
	return bytes;
}

function avif(w: number, h: number): Buffer {
	const ftyp = Buffer.alloc(24);
	ftyp.writeUInt32BE(24, 0);
	ftyp.write('ftypavif', 4, 'latin1');
	ftyp.write('mif1avif', 16, 'latin1');
	const ispe = (width: number, height: number): Buffer => {
		const box = Buffer.alloc(20);
		box.writeUInt32BE(20, 0);
		box.write('ispe', 4, 'latin1');
		box.writeUInt32BE(width, 12);
		box.writeUInt32BE(height, 16);
		return box;
	};
	return Buffer.concat([ftyp, ispe(64, 96), ispe(w, h)]);
}

const sha = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

describe('sniffImage', () => {
	it('reads the type and size from each format’s own header', () => {
		expect(sniffImage(png(342, 513))).toEqual({ type: 'image/png', w: 342, h: 513 });
		expect(sniffImage(jpeg(500, 750))).toEqual({ type: 'image/jpeg', w: 500, h: 750 });
		expect(sniffImage(Buffer.from('GIF89a\x10\x00\x20\x00', 'latin1'))).toEqual({
			type: 'image/gif',
			w: 16,
			h: 32
		});
		expect(sniffImage(webp('VP8 ', 300, 450))).toEqual({ type: 'image/webp', w: 300, h: 450 });
		expect(sniffImage(webp('VP8L', 300, 450))).toEqual({ type: 'image/webp', w: 300, h: 450 });
		expect(sniffImage(webp('VP8X', 3000, 4500))).toEqual({ type: 'image/webp', w: 3000, h: 4500 });
		expect(sniffImage(avif(1000, 1500))).toEqual({ type: 'image/avif', w: 1000, h: 1500 });
	});

	it('refuses what can run as a page, whatever it is called', () => {
		const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
		expect(sniffImage(Buffer.from(svg))).toBeNull();
		expect(sniffImage(Buffer.from('<!doctype html><script>alert(1)</script>'))).toBeNull();
		expect(sniffImage(Buffer.from('%PDF-1.7\n'))).toBeNull();
		expect(sniffImage(Buffer.alloc(0))).toBeNull();
	});

	it('refuses a header with no size', () => {
		expect(sniffImage(png(0, 10))).toBeNull();
		expect(sniffImage(jpeg(10, 0))).toBeNull();
	});
});

function setup() {
	const db = createDatabase(':memory:');
	runMigrations(db);
	const one = insertUser(db, { email: 'one@example.com' });
	const two = insertUser(db, { email: 'two@example.com' });
	return { db, one: one.id, two: two.id };
}

describe('receiveImagePart', () => {
	it('stores an image sent in parts, under the hash of its bytes', () => {
		const { db, one } = setup();
		const bytes = png(342, 513, 600);
		const id = sha(bytes);
		const at = { userId: one, baseId: 'b_home', id, size: bytes.length };

		expect(receiveImagePart(db, { ...at, offset: 0, bytes: bytes.subarray(0, 300) }, 0)).toEqual({
			status: 'partial',
			received: 300
		});
		const done = receiveImagePart(db, { ...at, offset: 300, bytes: bytes.subarray(300) }, 0);

		expect(done).toEqual({
			status: 'stored',
			ref: { id, type: 'image/png', w: 342, h: 513, size: bytes.length }
		});
		expect(readImage(db, one, 'b_home', id)?.data.equals(bytes)).toBe(true);
	});

	it('answers a second upload of the same bytes at once', () => {
		const { db, one } = setup();
		const bytes = png(10, 10);
		const part = { userId: one, baseId: 'b_home', id: sha(bytes), size: bytes.length, offset: 0 };
		receiveImagePart(db, { ...part, bytes }, 0);

		const again = receiveImagePart(db, { ...part, bytes: bytes.subarray(0, 4) }, 0);

		expect(again.status).toBe('stored');
	});

	it('refuses bytes that don’t hash to the id', () => {
		const { db, one } = setup();
		const bytes = png(10, 10);
		const forged = sha(png(20, 20));

		const result = receiveImagePart(
			db,
			{ userId: one, baseId: 'b_home', id: forged, size: bytes.length, offset: 0, bytes },
			0
		);

		expect(result).toEqual({ status: 'refused', reason: 'damaged' });
		expect(readImage(db, one, 'b_home', forged)).toBeUndefined();
	});

	it('refuses an SVG, an HTML page and a pixel bomb', () => {
		const { db, one } = setup();
		const send = (bytes: Buffer) =>
			receiveImagePart(
				db,
				{ userId: one, baseId: 'b_home', id: sha(bytes), size: bytes.length, offset: 0, bytes },
				0
			);

		expect(send(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toEqual({
			status: 'refused',
			reason: 'not-an-image'
		});
		expect(send(Buffer.from('<html><script>alert(1)</script>'))).toEqual({
			status: 'refused',
			reason: 'not-an-image'
		});
		expect(send(png(10_000, 10_000))).toEqual({ status: 'refused', reason: 'too-many-pixels' });
	});

	it('refuses a part that doesn’t follow the last one', () => {
		const { db, one } = setup();
		const bytes = png(10, 10, 600);
		const at = { userId: one, baseId: 'b_home', id: sha(bytes), size: bytes.length };
		receiveImagePart(db, { ...at, offset: 0, bytes: bytes.subarray(0, 100) }, 0);

		expect(receiveImagePart(db, { ...at, offset: 200, bytes: bytes.subarray(200) }, 0)).toEqual({
			status: 'refused',
			reason: 'out-of-order'
		});
		expect(receiveImagePart(db, { ...at, offset: 300, bytes: bytes.subarray(300) }, 0).status).toBe(
			'refused'
		);
	});

	it('holds an account to its storage, uploads under way included', () => {
		const { db, one, two } = setup();
		const big = png(10, 10, 700);
		const other = png(20, 20, 700);
		const limit = 1000;

		const started = receiveImagePart(
			db,
			{
				userId: one,
				baseId: 'b_home',
				id: sha(big),
				size: big.length,
				offset: 0,
				bytes: big.subarray(0, 100)
			},
			limit
		);
		const second = receiveImagePart(
			db,
			{
				userId: one,
				baseId: 'b_home',
				id: sha(other),
				size: other.length,
				offset: 0,
				bytes: other
			},
			limit
		);
		const elsewhere = receiveImagePart(
			db,
			{
				userId: two,
				baseId: 'b_home',
				id: sha(other),
				size: other.length,
				offset: 0,
				bytes: other
			},
			limit
		);

		expect(started.status).toBe('partial');
		expect(second).toEqual({ status: 'refused', reason: 'full' });
		expect(elsewhere.status).toBe('stored');
	});

	it('serves an image only to the account that holds it, base by base', () => {
		const { db, one, two } = setup();
		const bytes = png(10, 10);
		const id = sha(bytes);
		receiveImagePart(
			db,
			{ userId: one, baseId: 'b_home', id, size: bytes.length, offset: 0, bytes },
			0
		);

		expect(readImage(db, one, 'b_home', id)).toBeDefined();
		expect(readImage(db, two, 'b_home', id)).toBeUndefined();
		expect(readImage(db, one, 'b_other', id)).toBeUndefined();
	});
});
