import type { Rec } from './model.ts';
import { isRec } from './model.ts';

export type SyncRequest = { watermark: number; push: Rec[] };

export type SyncResponse = { records: Rec[]; watermark: number };

export const MAX_PUSH = 1000;

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
