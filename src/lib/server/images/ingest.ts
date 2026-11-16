import { createHash } from 'node:crypto';

import type { ImageRef } from '../../core/images.ts';
import { MAX_IMAGE_BYTES, isImageSource } from '../../core/images.ts';
import { perMinute } from '../auth/rate-limit.ts';
import { storageLimit } from '../config.ts';
import type { Database } from '../db/client.ts';
import { FetchRefused, guardedFetch } from '../net/guard.ts';
import { receiveImagePart } from './store.ts';

export type IngestProblem =
	| 'scheme'
	| 'address'
	| 'timeout'
	| 'network'
	| 'size'
	| 'status'
	| 'not-an-image'
	| 'too-many-pixels'
	| 'full'
	| 'busy';

export class IngestFailed extends Error {
	constructor(
		readonly problem: IngestProblem,
		readonly retryAfter: number | null = null
	) {
		super(`image fetch failed: ${problem}`);
		this.name = 'IngestFailed';
	}
}

const FETCH_MS = 10_000;
const MAX_HOPS = 3;
const ACCEPT = 'image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9,image/*;q=0.5';

// Every path in (a pasted link, a retype, the assistant, MCP) shares one budget per account.
const budget = perMinute(() => 300);

export type IngestOptions = { allowPrivate?: boolean; limit?: number };

function nameOf(url: URL): string | undefined {
	const last = url.pathname.split('/').at(-1) ?? '';
	let name: string;
	try {
		name = decodeURIComponent(last).trim();
	} catch {
		return undefined;
	}
	return /\.[a-z0-9]{2,5}$/iu.test(name) ? name : undefined;
}

/** The image at `url`, fetched once through the SSRF guard and stored in `baseId` like an upload. */
export async function ingestImage(
	db: Database,
	userId: string,
	baseId: string,
	url: string,
	options: IngestOptions = {}
): Promise<ImageRef> {
	const given = url.trim();
	if (!isImageSource(given)) {
		throw new IngestFailed('scheme');
	}
	const wait = budget(userId);
	if (wait !== null) {
		throw new IngestFailed('busy', wait);
	}

	let body: Buffer;
	try {
		const answer = await guardedFetch(given, {
			accept: ACCEPT,
			timeoutMs: FETCH_MS,
			maxBytes: MAX_IMAGE_BYTES,
			maxRedirects: MAX_HOPS,
			allowPrivate: options.allowPrivate
		});
		if (answer.status < 200 || answer.status >= 300) {
			throw new IngestFailed('status');
		}
		body = answer.body;
	} catch (error) {
		if (error instanceof FetchRefused) {
			throw new IngestFailed(error.reason);
		}
		throw error;
	}
	if (body.length === 0) {
		throw new IngestFailed('not-an-image');
	}

	const ref = storeImage(db, userId, baseId, body, options.limit ?? storageLimit());
	const name = nameOf(new URL(given));
	return { ...ref, ...(name === undefined ? {} : { name }), src: given };
}

export function storeImage(
	db: Database,
	userId: string,
	baseId: string,
	bytes: Buffer,
	limit: number
): ImageRef {
	const id = createHash('sha256').update(bytes).digest('hex');
	const received = receiveImagePart(
		db,
		{ userId, baseId, id, size: bytes.length, offset: 0, bytes },
		limit
	);
	if (received.status === 'stored') {
		return received.ref;
	}
	throw new IngestFailed(
		received.status === 'refused' &&
			(received.reason === 'full' || received.reason === 'too-many-pixels')
			? received.reason
			: 'not-an-image'
	);
}

/** Each distinct URL fetched once, a few at a time; a failure is kept per URL, never thrown. */
export async function ingestAll(
	urls: string[],
	fetch: (url: string) => Promise<ImageRef>,
	atOnce = 4
): Promise<Map<string, ImageRef | IngestFailed>> {
	const queue = [...new Set(urls)];
	const out = new Map<string, ImageRef | IngestFailed>();
	const worker = async (): Promise<void> => {
		for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
			try {
				out.set(url, await fetch(url));
			} catch (error) {
				out.set(url, error instanceof IngestFailed ? error : new IngestFailed('network'));
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(atOnce, queue.length) }, worker));
	return out;
}
