import { and, asc, eq, gt } from 'drizzle-orm';
import { z } from 'zod';

import type { Kind, Rec } from '../../core/model.ts';
import { isDeleted } from '../../core/model.ts';
import { findBase } from '../agent/toolkit.ts';
import type { Database } from '../db/client.ts';
import { loadWorkspace } from '../db/records.ts';
import { records } from '../db/schema.ts';
import type { Row } from './rows.ts';
import { shapeRows } from './rows.ts';
import { ApiError } from './errors.ts';

export const CHANGES = z.strictObject({
	base: z.string().describe('name or id of the base'),
	since: z.string().optional().describe('the cursor of the previous answer'),
	limit: z.number().int().min(1).max(100).optional().describe('changes per answer, 100 by default')
});

type Change = { kind: Kind; id: string; table: string | null; deleted: boolean; row?: Row };

// Bound to its base, so a feed keeps working once a base's changes are counted per base.
function cursorOf(base: string, seq: number): string {
	return Buffer.from(`${base}:${seq}`).toString('base64url');
}

function seqOf(cursor: string, base: string): number {
	const [owner, seq] = Buffer.from(cursor, 'base64url').toString('utf8').split(':');
	if (owner !== base || seq === undefined || !/^\d+$/u.test(seq)) {
		throw new ApiError(400, 'invalid', 'since is not a cursor this feed gave for this base');
	}
	return Number(seq);
}

function tableOf(rec: Rec): string | null {
	if (rec.kind === 'table') return rec.id;
	return rec.kind === 'base' ? null : rec.parent;
}

export async function readChanges(
	db: Database,
	userId: string,
	query: z.infer<typeof CHANGES>
): Promise<{ changes: Change[]; cursor: string; more: boolean }> {
	let base: string;
	try {
		base = findBase(loadWorkspace(db, userId), query.base).id;
	} catch (error) {
		throw new ApiError(404, 'not_found', (error as Error).message);
	}
	const since = query.since === undefined ? 0 : seqOf(query.since, base);
	const limit = query.limit ?? 100;

	const found = db
		.select({ seq: records.seq, record: records.record })
		.from(records)
		.where(and(eq(records.userId, userId), eq(records.baseId, base), gt(records.seq, since)))
		.orderBy(asc(records.seq))
		.limit(limit + 1)
		.all();
	const page = found.slice(0, limit);
	// Read after the changes, so no row they name is newer than what shapes it.
	const ws = loadWorkspace(db, userId, base);

	const changes: Change[] = page.map(({ record }) => ({
		kind: record.kind,
		id: record.id,
		table: tableOf(record),
		deleted: isDeleted(record) || (record.kind === 'row' && ws.table(record.parent) === undefined)
	}));

	const byTable = new Map<string, Rec[]>();
	for (const change of changes) {
		const rec = change.kind === 'row' && !change.deleted ? ws.live(change.id) : undefined;
		if (rec !== undefined) {
			byTable.set(rec.parent, [...(byTable.get(rec.parent) ?? []), rec]);
		}
	}
	const shaped = new Map<string, Row>();
	for (const [table, rows] of byTable) {
		for (const row of await shapeRows(ws, table, rows)) {
			shaped.set(row.id, row);
		}
	}
	for (const change of changes) {
		const row = shaped.get(change.id);
		if (row !== undefined) change.row = row;
		else if (change.kind === 'row') change.deleted = true;
	}

	const last = page.at(-1)?.seq ?? since;
	return { changes, cursor: cursorOf(base, last), more: found.length > limit };
}
