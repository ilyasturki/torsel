import { randomBytes } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import type { Rec } from '../../core/model.ts';
import { isDeleted } from '../../core/model.ts';
import { isPublishable } from '../../core/published.ts';
import type { Database } from '../db/client.ts';
import { WRITER } from '../db/client.ts';
import type { Publication } from '../db/schema.ts';
import { publications, records } from '../db/schema.ts';

// 128 random bits in base64url.
const TOKEN = /^[A-Za-z0-9_-]{22}$/u;

export function isToken(value: unknown): value is string {
	return typeof value === 'string' && TOKEN.test(value);
}

export function storedRecord(db: Database, userId: string, id: string): Rec | undefined {
	return db
		.select({ record: records.record })
		.from(records)
		.where(and(eq(records.userId, userId), eq(records.id, id)))
		.get()?.record;
}

/** The view as the server holds it, when a link may show it. */
export function publishableView(db: Database, userId: string, viewId: string): Rec | undefined {
	const rec = storedRecord(db, userId, viewId);
	return rec?.kind === 'view' && !isDeleted(rec) && isPublishable(String(rec.data.type ?? 'grid'))
		? rec
		: undefined;
}

export function listPublications(db: Database, userId: string): { view: string; token: string }[] {
	return db
		.select({ view: publications.viewId, token: publications.token })
		.from(publications)
		.where(eq(publications.userId, userId))
		.all();
}

/** The view's link, made on its first publish and the same after. */
export function publish(db: Database, userId: string, viewId: string): string {
	return db.transaction((tx) => {
		const held = tx
			.select({ token: publications.token })
			.from(publications)
			.where(and(eq(publications.userId, userId), eq(publications.viewId, viewId)))
			.get();
		if (held !== undefined) return held.token;
		const token = randomBytes(16).toString('base64url');
		tx.insert(publications).values({ token, userId, viewId, createdAt: new Date() }).run();
		return token;
	}, WRITER);
}

/** The token that stopped working, if the view had one. */
export function unpublish(db: Database, userId: string, viewId: string): string | undefined {
	return db
		.delete(publications)
		.where(and(eq(publications.userId, userId), eq(publications.viewId, viewId)))
		.returning({ token: publications.token })
		.get()?.token;
}

export function findPublication(db: Database, token: string): Publication | undefined {
	return isToken(token)
		? db.select().from(publications).where(eq(publications.token, token)).get()
		: undefined;
}
