import { migrate } from 'drizzle-orm/node-sqlite/migrator';
import { sql } from 'drizzle-orm';

import type { Database } from './client.ts';
import { migrationsFolder } from './config.ts';

export function runMigrations(db: Database, folder: string = migrationsFolder): void {
	const sqlite = db.$client;

	// With enforcement on, drizzle's column-change rebuild (`DROP TABLE users`) cascade-deletes its
	// dependents; the PRAGMA drizzle writes into the migration is a no-op inside a transaction.
	sqlite.exec('pragma foreign_keys = off');
	try {
		migrate(db, { migrationsFolder: folder });
	} finally {
		sqlite.exec('pragma foreign_keys = on');
	}

	const violations = sqlite.prepare('pragma foreign_key_check').all();
	if (violations.length > 0) {
		throw new Error(`migrations left ${violations.length} foreign key violation(s) behind`);
	}
}

export function appliedMigrationCount(db: Database): number {
	const table = db.get<{ name: string }>(
		sql`select name from sqlite_master where type = 'table' and name = '__drizzle_migrations'`
	);
	if (table === undefined) {
		return 0;
	}

	const row = db.get<{ count: number }>(
		sql`select count(*) as count from ${sql.identifier('__drizzle_migrations')}`
	);
	return row === undefined ? 0 : row.count;
}
