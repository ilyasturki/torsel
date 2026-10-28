import init from '@sqlite.org/sqlite-wasm';

import type { Engine, SqlRow, SqlValue } from './sql.ts';

export type MemoryEngine = Engine & { readOnly(): void; close(): void };

let loading: ReturnType<typeof init> | undefined;

// The same WebAssembly build on every device and on the server: one engine, one set of numbers.
export async function openEngine(): Promise<MemoryEngine> {
	const sqlite3 = await (loading ??= init());
	const db = new sqlite3.oo1.DB(':memory:');

	return {
		exec(sql: string, bind?: SqlValue[]): void {
			db.exec({ sql, bind: bind ?? [] });
		},
		all(sql: string, bind?: SqlValue[]): SqlRow[] {
			return db.exec({
				sql,
				bind: bind ?? [],
				rowMode: 'object',
				returnValue: 'resultRows'
			}) as SqlRow[];
		},
		readOnly(): void {
			db.exec('pragma query_only = on');
		},
		close(): void {
			db.close();
		}
	};
}
