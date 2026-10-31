import type { DBSchema, IDBPDatabase, IDBPTransaction } from 'idb';
import { openDB } from 'idb';

import type { Rec } from '../core/model.ts';

export type Stored = { id: string; rec: Rec; dirty: boolean };

type Schema = DBSchema & {
	records: { key: string; value: Stored };
	meta: { key: string; value: unknown };
};

export type LocalDb = IDBPDatabase<Schema>;

type Both = ['records', 'meta'];

const BOTH: Both = ['records', 'meta'];

export async function openLocal(name = 'torsel'): Promise<LocalDb> {
	return openDB<Schema>(name, 1, {
		upgrade(db) {
			db.createObjectStore('records', { keyPath: 'id' });
			db.createObjectStore('meta');
		}
	});
}

export async function readMeta<T>(db: LocalDb, key: string): Promise<T | undefined> {
	return (await db.get('meta', key)) as T | undefined;
}

/** Commits in the caller's task: a self-committing transaction awaits callbacks a dying page never runs, and is aborted. */
export async function save(
	db: LocalDb,
	entries: Stored[],
	meta: Record<string, unknown> = {}
): Promise<void> {
	const tx = db.transaction(BOTH, 'readwrite');
	const records = tx.objectStore('records');
	const metaStore = tx.objectStore('meta');
	const writes: Promise<unknown>[] = [tx.done];
	try {
		for (const entry of entries) {
			writes.push(records.put(entry));
		}
		for (const [key, value] of Object.entries(meta)) {
			writes.push(metaStore.put(value, key));
		}
		tx.commit();
	} catch (error) {
		tx.abort();
		await Promise.allSettled(writes);
		throw error;
	}
	await Promise.all(writes);
}

export function writeMeta(db: LocalDb, key: string, value: unknown): Promise<void> {
	return save(db, [], { [key]: value });
}

function wipe(
	tx: IDBPTransaction<Schema, Both, 'readwrite'>,
	drop: string[],
	owner?: string
): Promise<unknown[]> {
	const meta = tx.objectStore('meta');
	const writes: Promise<unknown>[] = [tx.objectStore('records').clear(), tx.done];
	for (const key of ['watermark', 'history', ...drop]) {
		writes.push(meta.delete(key));
	}
	if (owner !== undefined) {
		writes.push(meta.put(owner, 'owner'));
	}
	tx.commit();
	return Promise.all(writes);
}

/** A watermark that outlived its records would keep the server from ever sending them again. */
export async function erase(db: LocalDb, drop: string[] = []): Promise<void> {
	await wipe(db.transaction(BOTH, 'readwrite'), drop);
}

/** False, changing nothing, while a record here hasn't reached the server. */
export async function handOver(db: LocalDb, owner: string): Promise<boolean> {
	const tx = db.transaction(BOTH, 'readwrite');
	const stored = await tx.objectStore('records').getAll();
	if (stored.some((entry) => entry.dirty)) {
		tx.commit();
		await tx.done;
		return false;
	}
	await wipe(tx, [], owner);
	return true;
}
