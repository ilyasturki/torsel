import { describe, expect, it } from 'vitest';

import { createBase } from '#lib/core/actions.ts';
import { chartData } from '#lib/core/chart.ts';
import { Hlc } from '#lib/core/clock.ts';
import { openEngine } from '#lib/core/engine.ts';
import type { Change } from '#lib/core/model.ts';
import { materializeTable } from '#lib/core/sql.ts';
import { Workspace } from '#lib/core/workspace.ts';

import type { Cell } from './examples.ts';
import { EXAMPLES } from './examples.ts';
import { changesFor, seedExample } from './seed.ts';

const round = (value: unknown): unknown =>
	typeof value === 'number' ? Math.round(value * 100) / 100 : (value ?? '');

describe('each prepared prompt does what the engine computes', () => {
	it.each(EXAMPLES.map((example) => [example.id, example] as const))('%s', async (_id, example) => {
		const ws = new Workspace();
		const hlc = new Hlc('landing');
		const commit = (changes: Change[]): void => {
			for (const change of changes) ws.stamp(change, hlc.tick());
		};
		const base = createBase(ws, 'Sample');
		commit(base.changes);
		const sample = seedExample(ws, commit, base.id, example);
		expect(ws.views(sample.table).map((view) => view.name)).toEqual(['Grid', 'Entry']);
		const engine = await openEngine();

		// The rows as the prompts leave them, in the table's order.
		let rows: Cell[][] = example.rows.map((row) => [...row]);
		for (const prompt of example.prompts) {
			const made = changesFor(ws, example, sample, prompt);
			commit(made.changes);

			if (prompt.kind === 'rows') {
				rows = [...rows, ...prompt.rows];
				expect(ws.rows(sample.table)).toHaveLength(rows.length);
			} else if (prompt.kind === 'cell') {
				rows = rows.map((row) =>
					row[0] === prompt.row
						? row.map((cell, i) => (i === prompt.field ? prompt.value : cell))
						: row
				);
				const row = ws.rows(sample.table).find((rec) => rec.data[sample.fields[0]] === prompt.row);
				expect(row?.data[sample.fields[prompt.field]]).toBe(prompt.value);
			} else if (prompt.kind === 'formula') {
				const field = ws.fields(sample.table).find((candidate) => candidate.name === prompt.name);
				expect([...materializeTable(engine, ws, sample.table)]).toEqual([]);
				const computed = new Map(
					engine
						.all(`select id, ${field?.id} as out from v_${sample.table}`)
						.map((row) => [String(row.id), row.out])
				);
				expect(ws.rows(sample.table).map((row) => round(computed.get(row.id)))).toEqual(
					rows.map((row) => round(prompt.value(row)))
				);
			} else {
				const view = ws.views(sample.table).find((candidate) => candidate.id === made.view);
				expect(view?.name).toBe(prompt.name);
				materializeTable(engine, ws, sample.table);
				const data = chartData(engine, ws, sample.table, view?.config ?? {});
				expect(data?.yLabel).toBe(prompt.label);
				const totals = new Map<string, number>();
				for (const row of rows) {
					const key = String(row[prompt.group]);
					totals.set(
						key,
						(totals.get(key) ?? 0) + (prompt.value === null ? 1 : Number(row[prompt.value]))
					);
				}
				expect(Object.fromEntries((data?.points ?? []).map((point) => [point.x, point.y]))).toEqual(
					Object.fromEntries(totals)
				);
			}
		}
	});
});
