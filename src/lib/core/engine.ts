import init from '@sqlite.org/sqlite-wasm';

import type { Engine, SqlRow, SqlValue } from './sql.ts';

export type EngineLimits = { ms: number; length: number };

export type MemoryEngine = Engine & {
	readOnly(): void;
	/** Every later statement stops after `ms`, and no string or blob grows past `length` bytes. */
	bound(limits: EngineLimits): void;
	close(): void;
};

let loading: ReturnType<typeof init> | undefined;

const PROGRESS_STEPS = 1000;

// The same WebAssembly build on every device and on the server: one engine, one set of numbers.
export async function openEngine(): Promise<MemoryEngine> {
	const sqlite3 = await (loading ??= init());
	const { capi } = sqlite3;
	const db = new sqlite3.oo1.DB(':memory:');

	let budget: number | null = null;
	let deadline = Infinity;
	const start = (): void => {
		deadline = budget === null ? Infinity : Date.now() + budget;
	};

	return {
		exec(sql: string, bind?: SqlValue[]): void {
			start();
			db.exec({ sql, bind: bind ?? [] });
		},
		all(sql: string, bind?: SqlValue[]): SqlRow[] {
			start();
			return db.exec({
				sql,
				bind: bind ?? [],
				rowMode: 'object',
				returnValue: 'resultRows'
			}) as SqlRow[];
		},
		each(sql: string, take: (row: SqlRow) => boolean): void {
			start();
			const statement = db.prepare(sql);
			try {
				while (statement.step()) {
					if (!take(statement.get({}) as SqlRow)) break;
				}
			} finally {
				statement.finalize();
			}
		},
		readOnly(): void {
			db.exec('pragma query_only = on');
		},
		bound({ ms, length }: EngineLimits): void {
			budget = ms;
			capi.sqlite3_limit(db.pointer as number, capi.SQLITE_LIMIT_LENGTH, length);
			capi.sqlite3_progress_handler(
				db.pointer as number,
				PROGRESS_STEPS,
				() => (Date.now() > deadline ? 1 : 0),
				0
			);
		},
		close(): void {
			db.close();
		}
	};
}
