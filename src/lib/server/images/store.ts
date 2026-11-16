import { createHash } from 'node:crypto';

import { and, eq, lt, sum } from 'drizzle-orm';

import type { ImageRef } from '../../core/images.ts';
import { MAX_IMAGE_PIXELS } from '../../core/images.ts';
import type { Database } from '../db/client.ts';
import { WRITER } from '../db/client.ts';
import { blobUploads, blobs } from '../db/schema.ts';
import type { Executor } from '../db/seq.ts';
import { sniffImage } from './sniff.ts';

// An upload left unfinished this long is dropped, and stops counting against the account.
const UNFINISHED_MS = 60 * 60 * 1000;

export type Part = {
	userId: string;
	baseId: string;
	id: string;
	size: number;
	offset: number;
	bytes: Buffer;
};

export type Refusal = 'out-of-order' | 'full' | 'damaged' | 'not-an-image' | 'too-many-pixels';

export type Received =
	| { status: 'partial'; received: number }
	| { status: 'stored'; ref: ImageRef }
	| { status: 'refused'; reason: Refusal };

/** Bytes this account holds and has reserved for uploads under way. */
function used(tx: Executor, userId: string): number {
	const stored = tx
		.select({ total: sum(blobs.size) })
		.from(blobs)
		.where(eq(blobs.userId, userId))
		.get();
	const pending = tx
		.select({ total: sum(blobUploads.size) })
		.from(blobUploads)
		.where(eq(blobUploads.userId, userId))
		.get();
	return Number(stored?.total ?? 0) + Number(pending?.total ?? 0);
}

function find(tx: Executor, { userId, baseId, id }: Pick<Part, 'userId' | 'baseId' | 'id'>) {
	return tx
		.select({ id: blobs.id, type: blobs.type, w: blobs.w, h: blobs.h, size: blobs.size })
		.from(blobs)
		.where(and(eq(blobs.userId, userId), eq(blobs.baseId, baseId), eq(blobs.id, id)))
		.get();
}

const uploadOf = (part: Part) =>
	and(
		eq(blobUploads.userId, part.userId),
		eq(blobUploads.baseId, part.baseId),
		eq(blobUploads.id, part.id)
	);

/** Stores the image once every part is in and its bytes hash to its id; `limit` is the account's bytes, 0 for none. */
export function receiveImagePart(db: Database, part: Part, limit: number): Received {
	return db.transaction((tx) => {
		const existing = find(tx, part);
		if (existing !== undefined) {
			tx.delete(blobUploads).where(uploadOf(part)).run();
			return { status: 'stored', ref: existing as ImageRef };
		}

		let data: Buffer;
		if (part.offset === 0) {
			tx.delete(blobUploads)
				.where(lt(blobUploads.createdAt, new Date(Date.now() - UNFINISHED_MS)))
				.run();
			tx.delete(blobUploads).where(uploadOf(part)).run();
			if (part.bytes.length > part.size) {
				return { status: 'refused', reason: 'out-of-order' };
			}
			if (limit > 0 && used(tx, part.userId) + part.size > limit) {
				return { status: 'refused', reason: 'full' };
			}
			data = part.bytes;
			tx.insert(blobUploads)
				.values({
					userId: part.userId,
					baseId: part.baseId,
					id: part.id,
					size: part.size,
					data,
					createdAt: new Date()
				})
				.run();
		} else {
			const stored = tx
				.select({ data: blobUploads.data, size: blobUploads.size })
				.from(blobUploads)
				.where(uploadOf(part))
				.get();
			if (
				stored === undefined ||
				stored.size !== part.size ||
				stored.data.length !== part.offset ||
				part.offset + part.bytes.length > stored.size
			) {
				return { status: 'refused', reason: 'out-of-order' };
			}
			data = Buffer.concat([stored.data, part.bytes]);
			tx.update(blobUploads).set({ data }).where(uploadOf(part)).run();
		}

		if (data.length < part.size) {
			return { status: 'partial', received: data.length };
		}

		tx.delete(blobUploads).where(uploadOf(part)).run();
		if (createHash('sha256').update(data).digest('hex') !== part.id) {
			return { status: 'refused', reason: 'damaged' };
		}
		const sniffed = sniffImage(data);
		if (sniffed === null) {
			return { status: 'refused', reason: 'not-an-image' };
		}
		if (sniffed.w * sniffed.h > MAX_IMAGE_PIXELS) {
			return { status: 'refused', reason: 'too-many-pixels' };
		}
		const ref: ImageRef = { id: part.id, ...sniffed, size: data.length };
		tx.insert(blobs)
			.values({
				userId: part.userId,
				baseId: part.baseId,
				...ref,
				data,
				createdAt: new Date()
			})
			.run();
		return { status: 'stored', ref };
	}, WRITER);
}

export function readImage(
	db: Database,
	userId: string,
	baseId: string,
	id: string
): { type: string; data: Buffer } | undefined {
	return db
		.select({ type: blobs.type, data: blobs.data })
		.from(blobs)
		.where(and(eq(blobs.userId, userId), eq(blobs.baseId, baseId), eq(blobs.id, id)))
		.get();
}
