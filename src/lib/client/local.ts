import type { DBSchema, IDBPDatabase, IDBPTransaction } from 'idb';
import { openDB } from 'idb';

import type { Rec } from '../core/model.ts';
import type { ActionStatus } from '../core/thread.ts';

export type Stored = { id: string; rec: Rec; dirty: boolean };

/** A row of its own: writing one reads nothing, so another tab's write can't lose it. */
export type Decision = { thread: string; id: string; status: ActionStatus };

const DECISION = 'decision:';

export const decisionKey = (id: string): string => `${DECISION}${id}`;

export const isDecisionKey = (key: string): boolean => key.startsWith(DECISION);

const decisionKeys = (): IDBKeyRange => IDBKeyRange.bound(DECISION, `${DECISION}￿`);

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

export async function readDecisions(db: LocalDb): Promise<Decision[]> {
	return (await db.getAll('meta', decisionKeys())) as Decision[];
}

/** Keeps a row whose status moved on after `sent` left. */
export async function forgetDecisions(db: LocalDb, sent: Decision[]): Promise<void> {
	const tx = db.transaction('meta', 'readwrite');
	await Promise.all([
		...sent.map(async ({ id, status }) => {
			const key = decisionKey(id);
			const stored = (await tx.store.get(key)) as Decision | undefined;
			if (stored?.status === status) {
				await tx.store.delete(key);
			}
		}),
		tx.done
	]);
}

/** One snapshot: what a write told the other tabs about, and the history as it stands now. */
export async function readWritten<T>(
	db: LocalDb,
	ids: string[],
	metaKey: string
): Promise<{ entries: Stored[]; meta: T | undefined }> {
	const tx = db.transaction(BOTH, 'readonly');
	const records = tx.objectStore('records');
	const [entries, meta] = await Promise.all([
		Promise.all(ids.map((id) => records.get(id))),
		tx.objectStore('meta').get(metaKey),
		tx.done
	]);
	return {
		entries: entries.filter((entry) => entry !== undefined),
		meta: meta as T | undefined
	};
}

function wipe(
	tx: IDBPTransaction<Schema, Both, 'readwrite'>,
	drop: string[],
	owner?: string
): Promise<unknown[]> {
	const meta = tx.objectStore('meta');
	const writes: Promise<unknown>[] = [
		tx.objectStore('records').clear(),
		meta.delete(decisionKeys()),
		tx.done
	];
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

/** False, changing nothing, while a record or a decision here hasn't reached the server. */
export async function handOver(db: LocalDb, owner: string): Promise<boolean> {
	const tx = db.transaction(BOTH, 'readwrite');
	const stored = await tx.objectStore('records').getAll();
	const decisions = await tx.objectStore('meta').count(decisionKeys());
	if (decisions > 0 || stored.some((entry) => entry.dirty)) {
		tx.commit();
		await tx.done;
		return false;
	}
	await wipe(tx, [], owner);
	return true;
}
