import { describe, expect, it } from 'vitest';

import { chartSetup } from './actions.ts';
import { axisTicks } from './chart.ts';
import type { FieldDef, FieldType, Rec, Value } from './model.ts';

describe('axis ticks', () => {
	it('starts bars at zero and ends on a round value above the tallest', () => {
		expect(axisTicks(0, 1420)).toEqual([0, 500, 1000, 1500]);
		expect(axisTicks(0, 7)).toEqual([0, 2, 4, 6, 8]);
	});

	it('frames a weigh-in line closely, on round fifths', () => {
		expect(axisTicks(87.9, 88.4)).toEqual([87.8, 88, 88.2, 88.4]);
	});

	it('gives a flat line some room', () => {
		expect(axisTicks(80, 80)).toEqual([79, 79.5, 80, 80.5, 81]);
	});
});

describe('the first guess of a chart', () => {
	const field = (id: string, type: FieldType): FieldDef => ({ id, name: id, type }) as FieldDef;
	const row = (data: Record<string, Value>): Rec => ({ id: JSON.stringify(data), data }) as Rec;

	it('draws a daily measure as a line of its average', () => {
		const fields = [field('day', 'date'), field('kg', 'number'), field('gap', 'formula')];
		const rows = ['2026-11-01', '2026-11-02', '2026-11-04'].map((day) => row({ day, kg: 85 }));
		expect(chartSetup(fields, {}, rows)).toMatchObject({
			x: 'day',
			kind: 'line',
			agg: 'avg',
			y: 'kg',
			bucket: 'day'
		});
	});

	it('sums money', () => {
		const fields = [field('paid', 'date'), field('item', 'text'), field('amount', 'currency')];
		const rows = ['2026-11-01', '2026-11-03', '2026-11-08'].map((paid) => row({ paid }));
		expect(chartSetup(fields, {}, rows)).toMatchObject({ kind: 'bar', agg: 'sum', y: 'amount' });
	});

	it('counts a log of many rows a day, per week over months', () => {
		const fields = [field('date', 'date'), field('reps', 'number'), field('weight', 'number')];
		const rows = ['2026-05-07', '2026-05-07', '2026-10-29'].map((date) => row({ date }));
		expect(chartSetup(fields, {}, rows)).toMatchObject({
			kind: 'bar',
			agg: 'count',
			bucket: 'week'
		});
	});

	it('keeps what the view sets over the guess', () => {
		const fields = [field('day', 'date'), field('kg', 'number')];
		const rows = [row({ day: '2026-11-01' })];
		expect(chartSetup(fields, { kind: 'bar' }, rows)).toMatchObject({ kind: 'bar', agg: 'avg' });
	});

	it('counts by a choice when the table has no date', () => {
		const fields = [field('title', 'text'), field('status', 'choice')];
		expect(chartSetup(fields, {}, [])).toMatchObject({ x: 'status', agg: 'count' });
	});
});
