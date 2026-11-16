import type init from '@sqlite.org/sqlite-wasm';

import { registerFunctions } from './functions.ts';
import type { Engine, SqlRow, SqlValue } from './sql.ts';

export type Sqlite3 = Awaited<ReturnType<typeof init>>;

export type EngineLimits = { ms: number; length: number };

export type MemoryEngine = Engine & {
	readOnly(): void;
	/** Every later statement stops after `ms`, and no string or blob grows past `length` bytes. */
	bound(limits: EngineLimits): void;
	close(): void;
};

const PROGRESS_STEPS = 1000;

export function memoryEngine(sqlite3: Sqlite3): MemoryEngine {
	const { capi } = sqlite3;
	const db = new sqlite3.oo1.DB(':memory:');
	registerFunctions(sqlite3, db);

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
		each(sql: string, take: (row: SqlValue[]) => boolean): string[] {
			start();
			const statement = db.prepare(sql);
			try {
				const columns = statement.getColumnNames();
				while (statement.step()) {
					if (!take(statement.get([]) as SqlValue[])) break;
				}
				return columns;
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
