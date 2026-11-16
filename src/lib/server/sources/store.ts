import { and, asc, eq, isNotNull, lte, ne } from 'drizzle-orm';

import { isDeleted } from '../../core/model.ts';
import type { Database } from '../db/client.ts';
import type { Source } from '../db/schema.ts';
import { records, sources } from '../db/schema.ts';

export type SourceRow = Source;

export function readSource(db: Database, userId: string, tableId: string): Source | undefined {
	return db
		.select()
		.from(sources)
		.where(and(eq(sources.userId, userId), eq(sources.tableId, tableId)))
		.get();
}

export function sourceTables(db: Database, userId: string): string[] {
	return db
		.select({ table: sources.tableId })
		.from(sources)
		.where(eq(sources.userId, userId))
		.all()
		.map((row) => row.table);
}

/** Whether the table is there and not deleted, read from its own record alone. */
export function tableLives(db: Database, userId: string, tableId: string): boolean {
	const rec = db
		.select({ record: records.record })
		.from(records)
		.where(and(eq(records.userId, userId), eq(records.id, tableId)))
		.get()?.record;
	return rec?.kind === 'table' && !isDeleted(rec);
}

export function insertSource(db: Database, row: Source): void {
	db.insert(sources).values(row).run();
}

export function updateSource(
	db: Database,
	userId: string,
	tableId: string,
	set: Partial<Omit<Source, 'userId' | 'tableId' | 'baseId' | 'createdAt'>>
): void {
	db.update(sources)
		.set(set)
		.where(and(eq(sources.userId, userId), eq(sources.tableId, tableId)))
		.run();
}

export function deleteSource(db: Database, userId: string, tableId: string): void {
	db.delete(sources)
		.where(and(eq(sources.userId, userId), eq(sources.tableId, tableId)))
		.run();
}

/** Scheduled sources whose time has come, the longest waiting first. */
export function dueSources(db: Database, now: Date, limit: number): Source[] {
	return db
		.select()
		.from(sources)
		.where(and(isNotNull(sources.nextAt), lte(sources.nextAt, now), ne(sources.every, 'manual')))
		.orderBy(asc(sources.nextAt))
		.limit(limit)
		.all();
}
