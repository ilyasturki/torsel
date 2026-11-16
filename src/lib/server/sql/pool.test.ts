import { afterAll, describe, expect, it, vi } from 'vitest';

import names from '#lib/i18n/names.ts';

import { createBase, createTable, defaultViews, insertRows } from '../../core/actions.ts';
import { Hlc } from '../../core/clock.ts';
import type { Change, Rec } from '../../core/model.ts';
import { Workspace } from '../../core/workspace.ts';
import { SqlPool } from './pool.ts';

const pool = new SqlPool(1);
afterAll(() => pool.close());

function base(): { records: Rec[]; base: string } {
	const ws = new Workspace();
	const hlc = new Hlc('test');
	const apply = ({ changes }: { changes: Change[] }): void => {
		for (const change of changes) ws.stamp(change, hlc.tick());
	};
	const made = createBase(ws, 'Gym');
	apply(made);
	const table = createTable(
		ws,
		made.id,
		'Sets',
		[
			{ name: 'Exercise', type: 'text' },
			{ name: 'Weight', type: 'number' }
		],
		() => defaultViews(names.en)
	);
	apply(table);
	apply(insertRows(ws, table.id, [{}, {}]));
	return { records: [...ws.records.values()], base: made.id };
}

const RUNAWAY =
	'with recursive c(x) as (select 1 union all select x + 1 from c) select count(*) from c';

describe('sql pool', () => {
	it('reads a page of rows', async () => {
		const { records, base: id } = base();

		const page = await pool.run(records, id, {
			kind: 'query',
			sql: 'select 1 as a, 2 as b',
			offset: 0
		});

		expect(page).toEqual({ columns: ['a', 'b'], rows: [[1, 2]], next: null, cut: 0 });
	});

	it('keeps the main thread free while a runaway query runs', async () => {
		const { records, base: id } = base();
		const started = Date.now();

		const runaway = pool.run(records, id, { kind: 'query', sql: RUNAWAY, offset: 0 });
		const tick = await new Promise<number>((resolve) => {
			const asked = Date.now();
			setTimeout(() => resolve(Date.now() - asked), 20);
		});

		await expect(runaway).rejects.toThrow('interrupted');
		expect(tick).toBeLessThan(100);
		expect(Date.now() - started).toBeLessThan(2_000);
	});

	it('writes nothing of a refused query to the logs', async () => {
		const { records, base: id } = base();
		const written: string[] = [];
		const write = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
			written.push(String(chunk));
			return true;
		});
		const warn = vi.spyOn(console, 'warn').mockImplementation((...args) => {
			written.push(args.join(' '));
		});
		try {
			await expect(
				pool.run(records, id, { kind: 'query', sql: "select secret_fn('hunter2')", offset: 0 })
			).rejects.toThrow('no such function: secret_fn');
			await expect(
				pool.run(records, id, { kind: 'query', sql: RUNAWAY, offset: 0 })
			).rejects.toThrow('interrupted');
			await new Promise((resolve) => setTimeout(resolve, 100));
		} finally {
			write.mockRestore();
			warn.mockRestore();
		}

		expect(written.join('')).not.toMatch(/hunter2|recursive|sqlite3_step/u);
	});

	it('kills a worker past the backstop and serves the next job', async () => {
		const { records, base: id } = base();

		await expect(
			pool.run(
				records,
				id,
				{ kind: 'query', sql: RUNAWAY, offset: 0 },
				{ ms: 60_000, length: 1_000_000, backstop: 200 }
			)
		).rejects.toThrow('interrupted');

		const page = await pool.run(records, id, { kind: 'query', sql: 'select 7 as n', offset: 0 });
		expect(page.rows).toEqual([[7]]);
	});

	it('kills a worker stuck in a regex, which SQLite cannot interrupt, and serves the next job', async () => {
		const { records, base: id } = base();

		await expect(
			pool.run(
				records,
				id,
				{ kind: 'query', sql: "select REGEXMATCH(REPT('a', 40) || 'b', '^(a+)+$')", offset: 0 },
				{ ms: 500, length: 1_000_000, backstop: 300 }
			)
		).rejects.toThrow('interrupted');

		const page = await pool.run(records, id, { kind: 'query', sql: 'select 8 as n', offset: 0 });
		expect(page.rows).toEqual([[8]]);
	});
});
