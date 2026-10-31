import { describe, expect, it } from 'vitest';

import { createBase } from '#lib/core/actions.ts';
import { chartData } from '#lib/core/chart.ts';
import { Hlc } from '#lib/core/clock.ts';
import { openEngine } from '#lib/core/engine.ts';
import type { Change } from '#lib/core/model.ts';
import { materializeTable } from '#lib/core/sql.ts';
import { Workspace } from '#lib/core/workspace.ts';

import { EXAMPLES, type ViewStep } from './examples.ts';
import { seedExample } from './seed.ts';

const round = (value: unknown): unknown =>
	typeof value === 'number' ? Math.round(value * 100) / 100 : (value ?? '');

describe('what the landing replays is what the engine does', () => {
	it.each(EXAMPLES.map((example) => [example.id, example] as const))('%s', async (_id, example) => {
		const ws = new Workspace();
		const hlc = new Hlc('landing');
		const commit = (changes: Change[]): void => {
			for (const change of changes) ws.stamp(change, hlc.tick());
		};
		const base = createBase(ws, 'Sample');
		commit(base.changes);
		const sample = seedExample(ws, commit, base.id, example);

		const engine = await openEngine();
		expect([...materializeTable(engine, ws, sample.table)]).toEqual([]);

		const computed = new Map(
			engine
				.all(`select id, ${sample.column} as out from v_${sample.table}`)
				.map((row) => [String(row.id), row.out])
		);
		const rows = ws.rows(sample.table);
		expect(rows.map((row) => round(computed.get(row.id)))).toEqual(
			example.rows.map((row) => round(example.column.value(row)))
		);

		const chartStep = [example.first, example.second].find(
			(step): step is Extract<ViewStep, { view: 'chart' }> => step.view === 'chart'
		);
		if (chartStep === undefined) throw new Error('every example ends on a chart');
		const data = chartData(engine, ws, sample.table, {
			kind: 'bar',
			x: sample.fields[chartStep.group],
			agg: chartStep.value === null ? 'count' : 'sum',
			y: chartStep.value === null ? null : sample.fields[chartStep.value]
		});
		expect(data?.yLabel).toBe(chartStep.label);
		const totals = new Map<string, number>();
		for (const row of example.rows) {
			const key = String(row[chartStep.group]);
			const amount = chartStep.value === null ? 1 : Number(row[chartStep.value]);
			totals.set(key, (totals.get(key) ?? 0) + amount);
		}
		expect(Object.fromEntries((data?.points ?? []).map((point) => [point.x, point.y]))).toEqual(
			Object.fromEntries(totals)
		);
	});
});
