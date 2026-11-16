import type { Rec } from './model.ts';
import { isRec } from './model.ts';

export type SyncRequest = { watermark: number; push: Rec[] };

/** A write the server took back, each key restamped with the value it keeps. */
export type Refusal = { id: string; keys: string[] };

export type SyncResponse = { records: Rec[]; watermark: number; refused: Refusal[] };

export const MAX_PUSH = 1000;

// adapter-node refuses a body over BODY_SIZE_LIMIT, 512K unless the server sets it.
const MAX_PUSH_BYTES = 400_000;
const utf8 = new TextEncoder();

/** The dirty records one sync request carries: never empty when some are dirty, even one over the limit. */
export function pushBatch(dirty: Rec[]): Rec[] {
	const batch: Rec[] = [];
	let bytes = 0;
	for (const rec of dirty.slice(0, MAX_PUSH)) {
		bytes += utf8.encode(JSON.stringify(rec)).length + 1;
		if (batch.length > 0 && bytes > MAX_PUSH_BYTES) {
			break;
		}
		batch.push(rec);
	}
	return batch;
}

export function isSyncRequest(value: unknown): value is SyncRequest {
	if (typeof value !== 'object' || value === null) {
		return false;
	}

	const { watermark, push } = value as Record<string, unknown>;

	return (
		typeof watermark === 'number' &&
		Number.isInteger(watermark) &&
		watermark >= 0 &&
		Array.isArray(push) &&
		push.length <= MAX_PUSH &&
		push.every((rec) => isRec(rec))
	);
}
