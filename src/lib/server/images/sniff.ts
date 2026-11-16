import type { ImageType } from '../../core/images.ts';

export type Sniffed = { type: ImageType; w: number; h: number };

const ascii = (bytes: Buffer, at: number, text: string): boolean =>
	bytes.length >= at + text.length && bytes.toString('latin1', at, at + text.length) === text;

function png(bytes: Buffer): Sniffed | null {
	const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature) || !ascii(bytes, 12, 'IHDR')) {
		return null;
	}
	return { type: 'image/png', w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
}

function gif(bytes: Buffer): Sniffed | null {
	if (bytes.length < 10 || !(ascii(bytes, 0, 'GIF87a') || ascii(bytes, 0, 'GIF89a'))) {
		return null;
	}
	return { type: 'image/gif', w: bytes.readUInt16LE(6), h: bytes.readUInt16LE(8) };
}

// Start of frame markers carry the size; C4, C8 and CC share the range but are tables.
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function jpeg(bytes: Buffer): Sniffed | null {
	if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
		return null;
	}
	let at = 2;
	while (at + 9 < bytes.length) {
		if (bytes[at] !== 0xff) {
			return null;
		}
		const marker = bytes[at + 1];
		if (marker === 0xff) {
			at += 1;
			continue;
		}
		if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
			at += 2;
			continue;
		}
		if (marker === 0xd9 || marker === 0xda) {
			return null;
		}
		if (SOF.has(marker)) {
			return { type: 'image/jpeg', w: bytes.readUInt16BE(at + 7), h: bytes.readUInt16BE(at + 5) };
		}
		at += 2 + bytes.readUInt16BE(at + 2);
	}
	return null;
}

function webp(bytes: Buffer): Sniffed | null {
	if (bytes.length < 30 || !ascii(bytes, 0, 'RIFF') || !ascii(bytes, 8, 'WEBP')) {
		return null;
	}
	if (ascii(bytes, 12, 'VP8 ')) {
		if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) {
			return null;
		}
		return {
			type: 'image/webp',
			w: bytes.readUInt16LE(26) & 0x3fff,
			h: bytes.readUInt16LE(28) & 0x3fff
		};
	}
	if (ascii(bytes, 12, 'VP8L')) {
		if (bytes[20] !== 0x2f) {
			return null;
		}
		const bits = bytes.readUInt32LE(21);
		return { type: 'image/webp', w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1 };
	}
	if (ascii(bytes, 12, 'VP8X')) {
		return { type: 'image/webp', w: bytes.readUIntLE(24, 3) + 1, h: bytes.readUIntLE(27, 3) + 1 };
	}
	return null;
}

const AVIF_BRANDS = new Set(['avif', 'avis']);

// The largest `ispe` is the primary image's: thumbnails and grid tiles carry smaller ones.
function avif(bytes: Buffer): Sniffed | null {
	if (bytes.length < 16 || !ascii(bytes, 4, 'ftyp')) {
		return null;
	}
	const boxEnd = Math.min(bytes.length, bytes.readUInt32BE(0));
	let branded = false;
	for (let at = 8; at + 4 <= boxEnd; at += 4) {
		if (at !== 12 && AVIF_BRANDS.has(bytes.toString('latin1', at, at + 4))) {
			branded = true;
		}
	}
	if (!branded) {
		return null;
	}
	let best: Sniffed | null = null;
	const scan = bytes.subarray(0, Math.min(bytes.length, 64 * 1024));
	for (let at = scan.indexOf('ispe', 0, 'latin1'); at !== -1;) {
		if (at + 16 <= scan.length) {
			const w = scan.readUInt32BE(at + 8);
			const h = scan.readUInt32BE(at + 12);
			if (best === null || w * h > best.w * best.h) {
				best = { type: 'image/avif', w, h };
			}
		}
		at = scan.indexOf('ispe', at + 4, 'latin1');
	}
	return best;
}

/** The image these bytes are, read from their own header; null for anything else, SVG and HTML included. */
export function sniffImage(bytes: Buffer): Sniffed | null {
	for (const read of [png, jpeg, gif, webp, avif]) {
		const found = read(bytes);
		if (found !== null) {
			return found.w > 0 && found.h > 0 ? found : null;
		}
	}
	return null;
}
