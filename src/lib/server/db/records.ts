import { and, eq, gt, inArray } from 'drizzle-orm';

import { Hlc } from '../../core/clock.ts';
import { latestClock, merge, sameRec } from '../../core/merge.ts';
import type { Change, Rec } from '../../core/model.ts';
import type { SyncRequest, SyncResponse } from '../../core/protocol.ts';
import { Workspace } from '../../core/workspace.ts';
import type { Database } from './client.ts';
import { WRITER } from './client.ts';
import { records } from './schema.ts';
import type { Executor } from './seq.ts';
import { claimSeq } from './seq.ts';

function stored(tx: Executor, userId: string, id: string): Rec | undefined {
	return tx
		.select({ record: records.record })
		.from(records)
		.where(and(eq(records.userId, userId), eq(records.id, id)))
		.get()?.record;
}

/** Merges one record into the user's store; the settled record, and whether anything moved. */
export function mergeRecord(
	tx: Executor,
	userId: string,
	incoming: Rec
): { rec: Rec; moved: boolean } {
	const existing = stored(tx, userId, incoming.id);

	if (existing !== undefined && existing.kind !== incoming.kind) {
		return { rec: existing, moved: false };
	}

	const rec = merge(existing, incoming);

	if (existing !== undefined && sameRec(existing, rec)) {
		return { rec, moved: false };
	}

	const seq = claimSeq(tx, userId);
	const values = { userId, id: rec.id, baseId: rec.base, seq, record: rec };

	tx.insert(records)
		.values(values)
		.onConflictDoUpdate({ target: [records.userId, records.id], set: values })
		.run();

	return { rec, moved: true };
}

export function syncExchange(db: Database, userId: string, request: SyncRequest): SyncResponse {
	return db.transaction((tx) => {
		const out = new Map<string, Rec>();
		const pushed = new Map(request.push.map((rec) => [rec.id, rec]));

		for (const incoming of request.push) {
			const { rec } = mergeRecord(tx, userId, incoming);

			if (!sameRec(rec, incoming)) {
				out.set(rec.id, rec);
			}
		}

		const fresh = tx
			.select({ seq: records.seq, record: records.record })
			.from(records)
			.where(and(eq(records.userId, userId), gt(records.seq, request.watermark)))
			.orderBy(records.seq)
			.all();

		let watermark = request.watermark;

		for (const row of fresh) {
			watermark = row.seq;

			if (!sameRec(row.record, pushed.get(row.record.id))) {
				out.set(row.record.id, row.record);
			}
		}

		return { records: [...out.values()], watermark };
	}, WRITER);
}

export function loadWorkspace(db: Database, userId: string, baseId?: string): Workspace {
	const scope =
		baseId === undefined
			? eq(records.userId, userId)
			: and(eq(records.userId, userId), inArray(records.baseId, [baseId]));

	const ws = new Workspace();

	for (const row of db.select({ record: records.record }).from(records).where(scope).all()) {
		ws.put(row.record);
	}

	return ws;
}

/** Writes changes made on the server — an MCP call — stamped later than anything they touch. */
export function writeChanges(
	db: Database,
	userId: string,
	ws: Workspace,
	changes: Change[]
): Rec[] {
	const hlc = new Hlc('srv');

	for (const change of changes) {
		const existing = ws.get(change.id);
		if (existing !== undefined) {
			hlc.observe(latestClock(existing));
		}
	}

	const stamped = changes.map((change) => ws.stamp(change, hlc.tick()).rec);

	return db.transaction((tx) => stamped.map((rec) => mergeRecord(tx, userId, rec).rec), WRITER);
}
