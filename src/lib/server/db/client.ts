import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { NodeSQLiteDatabase } from 'drizzle-orm/node-sqlite';
import { drizzle } from 'drizzle-orm/node-sqlite';

import { databasePath } from './config.ts';

export type Database = NodeSQLiteDatabase & { $client: DatabaseSync };

// Deferred, a transaction that reads first fails outright (SQLITE_BUSY_SNAPSHOT, no busy wait) once another connection commits before its first write.
export const WRITER = { behavior: 'immediate' } as const;

// node:sqlite is synchronous, so a wait blocks the event loop; 5s still lost writes on a loaded machine.
const BUSY_TIMEOUT_MS = 30_000;

export function createDatabase(file: string = databasePath): Database {
	if (file !== ':memory:') {
		mkdirSync(path.dirname(file), { recursive: true });
	}

	// At open rather than by pragma: `journal_mode = wal` below already needs the lock.
	const sqlite = new DatabaseSync(file, { timeout: BUSY_TIMEOUT_MS });

	sqlite.exec('pragma foreign_keys = on');

	if (file !== ':memory:') {
		sqlite.exec('pragma journal_mode = wal');
		sqlite.exec('pragma synchronous = normal');
	}

	return drizzle({ client: sqlite });
}

let instance: Database | undefined;

export function getDatabase(): Database {
	return (instance ??= createDatabase());
}

if (import.meta.hot) {
	import.meta.hot.dispose(() => {
		if (instance) {
			instance.$client.close();
			instance = undefined;
		}
	});
}
