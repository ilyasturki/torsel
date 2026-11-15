import { afterAll, describe, expect, it } from 'vitest';

import { createBase, createTable, insertRows } from '../../core/actions.ts';
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
	const table = createTable(ws, made.id, 'Sets', [
		{ name: 'Exercise', type: 'text' },
		{ name: 'Weight', type: 'number' }
	]);
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
});
