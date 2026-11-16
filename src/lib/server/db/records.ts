import { and, eq, gt, inArray } from 'drizzle-orm';

import type { Actor, Lookup } from '../../core/access.ts';
import { lockedKeys } from '../../core/access.ts';
import { Hlc } from '../../core/clock.ts';
import { latestClock, merge, sameRec } from '../../core/merge.ts';
import type { Change, Rec } from '../../core/model.ts';
import { DELETED } from '../../core/model.ts';
import type { Refusal, SyncRequest, SyncResponse } from '../../core/protocol.ts';
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

// Per account: writes in one millisecond stay ordered, and no account's future-dated record skews another's.
const clocks = new Map<string, Hlc>();

function clockOf(userId: string): Hlc {
	let hlc = clocks.get(userId);
	if (hlc === undefined) {
		hlc = new Hlc('srv');
		clocks.set(userId, hlc);
	}
	return hlc;
}

/** Who writes inside one transaction, and the account's records as it reads them, each once. */
type Writer = {
	tx: Executor;
	actor: Actor;
	get: Lookup;
	held: Map<string, Rec | undefined>;
};

function writerOf(tx: Executor, actor: Actor): Writer {
	const held = new Map<string, Rec | undefined>();
	const get = (id: string): Rec | undefined => {
		if (!held.has(id)) {
			held.set(id, stored(tx, actor.user, id));
		}
		return held.get(id);
	};
	return { tx, actor, get, held };
}

/** The keys whose clock is newer than the stored one: what merging would change. */
function moving(existing: Rec | undefined, incoming: Rec): string[] {
	return Object.keys(incoming.clocks).filter((key) => {
		const mine = existing?.clocks[key];
		return mine === undefined || incoming.clocks[key] > mine;
	});
}

/** Refused keys get the stored value back under a newer clock so the writer converges; a refused creation is tombstoned. */
function guarded(writer: Writer, existing: Rec | undefined, incoming: Rec, refused: string[]): Rec {
	const hlc = clockOf(writer.actor.user);
	for (const key of refused) {
		hlc.observe(incoming.clocks[key]);
	}
	const clock = hlc.tick();

	if (existing === undefined && refused.length === Object.keys(incoming.clocks).length) {
		const { id, kind, base, parent } = incoming;
		return { id, kind, base, parent, data: { [DELETED]: true }, clocks: { [DELETED]: clock } };
	}

	const data = { ...incoming.data };
	const kept = { ...incoming.clocks };
	for (const key of refused) {
		delete data[key];
		delete kept[key];
	}
	const rec = merge(existing, { ...incoming, data, clocks: kept });
	for (const key of refused) {
		rec.data[key] = existing?.data[key] ?? null;
		rec.clocks[key] = clock;
	}
	return rec;
}

/** Merges one record into the account's store; the settled record, whether anything moved, and the keys refused. */
export function mergeRecord(
	writer: Writer,
	incoming: Rec
): { rec: Rec; moved: boolean; refused: string[] } {
	const { tx, actor } = writer;
	const existing = writer.get(incoming.id);

	if (existing !== undefined && existing.kind !== incoming.kind) {
		return { rec: existing, moved: false, refused: [] };
	}

	const refused = lockedKeys(writer.get, actor, incoming, moving(existing, incoming));
	const rec =
		refused.length === 0 ? merge(existing, incoming) : guarded(writer, existing, incoming, refused);

	if (existing !== undefined && sameRec(existing, rec)) {
		return { rec, moved: false, refused };
	}

	const seq = claimSeq(tx, actor.user);
	const values = { userId: actor.user, id: rec.id, baseId: rec.base, seq, record: rec };

	tx.insert(records)
		.values(values)
		.onConflictDoUpdate({ target: [records.userId, records.id], set: values })
		.run();
	writer.held.set(rec.id, rec);

	return { rec, moved: true, refused };
}

export function syncExchange(db: Database, actor: Actor, request: SyncRequest): SyncResponse {
	return db.transaction((tx) => {
		const writer = writerOf(tx, actor);
		const out = new Map<string, Rec>();
		const refused: Refusal[] = [];
		const pushed = new Map(request.push.map((rec) => [rec.id, rec]));

		for (const incoming of request.push) {
			const merged = mergeRecord(writer, incoming);

			if (merged.refused.length > 0) {
				refused.push({ id: incoming.id, keys: merged.refused });
			}
			if (!sameRec(merged.rec, incoming)) {
				out.set(merged.rec.id, merged.rec);
			}
		}

		const fresh = tx
			.select({ seq: records.seq, record: records.record })
			.from(records)
			.where(and(eq(records.userId, actor.user), gt(records.seq, request.watermark)))
			.orderBy(records.seq)
			.all();

		let watermark = request.watermark;

		for (const row of fresh) {
			watermark = row.seq;

			if (!sameRec(row.record, pushed.get(row.record.id))) {
				out.set(row.record.id, row.record);
			}
		}

		return { records: [...out.values()], watermark, refused };
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

/** Writes changes made on the server — an MCP call, a connector run — stamped later than anything they touch. */
export function writeChanges(db: Database, actor: Actor, ws: Workspace, changes: Change[]): Rec[] {
	const hlc = clockOf(actor.user);
	for (const change of changes) {
		const existing = ws.get(change.id);
		if (existing !== undefined) {
			hlc.observe(latestClock(existing));
		}
	}

	const stamped = changes.map((change) => ws.stamp(change, hlc.tick()).rec);

	return db.transaction((tx) => {
		const writer = writerOf(tx, actor);
		return stamped.map((rec) => mergeRecord(writer, rec).rec);
	}, WRITER);
}
