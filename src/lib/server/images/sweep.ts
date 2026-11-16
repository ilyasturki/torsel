import { and, eq } from 'drizzle-orm';

import { imagesOf } from '../../core/images.ts';
import type { Workspace } from '../../core/workspace.ts';
import type { Database } from '../db/client.ts';
import { WRITER } from '../db/client.ts';
import { loadWorkspace } from '../db/records.ts';
import { blobs } from '../db/schema.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

// Undoing a removal, a row's, a field's or a base's deletion finds the bytes for this long.
export const KEPT_UNNAMED_MS = 30 * DAY_MS;

const STARTUP_MS = 60_000;

const key = (baseId: string, id: string): string => `${baseId}/${id}`;

/** Images a live row names in a live image field of a live table of a live base. */
export function namedImages(ws: Workspace): Set<string> {
	const named = new Set<string>();
	for (const base of ws.bases()) {
		for (const table of ws.tables(base.id)) {
			const fields = ws.fields(table.id).filter((field) => field.type === 'image');
			if (fields.length === 0) continue;
			for (const row of ws.rows(table.id)) {
				for (const field of fields) {
					for (const ref of imagesOf(row.data[field.id])) {
						named.add(key(base.id, ref.id));
					}
				}
			}
		}
	}
	return named;
}

/** Deletes each image nothing live has named for 30 days; returns how many went. */
export function sweepImages(db: Database, now: Date = new Date()): number {
	const users = db.selectDistinct({ userId: blobs.userId }).from(blobs).all();
	let deleted = 0;
	for (const { userId } of users) {
		const named = namedImages(loadWorkspace(db, userId));
		const stored = db
			.select({ baseId: blobs.baseId, id: blobs.id, unnamedSince: blobs.unnamedSince })
			.from(blobs)
			.where(eq(blobs.userId, userId))
			.all();
		db.transaction((tx) => {
			for (const blob of stored) {
				const at = and(
					eq(blobs.userId, userId),
					eq(blobs.baseId, blob.baseId),
					eq(blobs.id, blob.id)
				);
				if (named.has(key(blob.baseId, blob.id))) {
					if (blob.unnamedSince !== null) {
						tx.update(blobs).set({ unnamedSince: null }).where(at).run();
					}
				} else if (blob.unnamedSince === null) {
					tx.update(blobs).set({ unnamedSince: now }).where(at).run();
				} else if (now.getTime() - blob.unnamedSince.getTime() >= KEPT_UNNAMED_MS) {
					tx.delete(blobs).where(at).run();
					deleted += 1;
				}
			}
		}, WRITER);
	}
	return deleted;
}

let timer: ReturnType<typeof setInterval> | undefined;

/** Once a day, and a minute after start; the timers never keep the process alive. */
export function startImageSweep(db: Database): void {
	if (timer !== undefined) return;
	const run = (): void => {
		try {
			const deleted = sweepImages(db);
			if (deleted > 0) console.info(`image sweep: ${deleted} deleted`);
		} catch (error) {
			console.error('image sweep failed:', error);
		}
	};
	timer = setInterval(run, DAY_MS);
	timer.unref();
	setTimeout(run, STARTUP_MS).unref();
}
