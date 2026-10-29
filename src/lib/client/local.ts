import type { DBSchema, IDBPDatabase } from 'idb';
import { openDB } from 'idb';

import type { Rec } from '../core/model.ts';

export type Stored = { id: string; rec: Rec; dirty: boolean };

type Schema = DBSchema & {
	records: { key: string; value: Stored };
	meta: { key: string; value: unknown };
};

export type LocalDb = IDBPDatabase<Schema>;

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

export async function writeMeta(db: LocalDb, key: string, value: unknown): Promise<void> {
	await db.put('meta', value, key);
}

export async function putRecords(db: LocalDb, entries: Stored[]): Promise<void> {
	const tx = db.transaction('records', 'readwrite');
	await Promise.all([...entries.map((entry) => tx.store.put(entry)), tx.done]);
}
