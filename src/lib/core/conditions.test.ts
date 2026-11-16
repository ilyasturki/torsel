import { describe, expect, it } from 'vitest';

import type { ColorRule, Condition, Reading } from './conditions.ts';
import {
	colorTest,
	conditionTest,
	daySpan,
	kindOf,
	meets,
	OPS_OF,
	scaleStep,
	totalOf,
	totalsFor
} from './conditions.ts';
import type { FieldDef, FieldType, Rec } from './model.ts';

function field(id: string, type: FieldType, extra: Partial<FieldDef> = {}): FieldDef {
	return {
		id,
		base: 'b',
		table: 't',
		name: id,
		type,
		order: 0,
		choices: [],
		target: null,
		expr: null,
		description: null,
		step: null,
		decimals: null,
		grouping: false,
		unit: null,
		currency: null,
		min: null,
		max: null,
		seconds: false,
		dateStyle: null,
		result: null,
		auto: false,
		fill: null,
		...extra
	};
}

const read: Reading = {
	text: (_, value) => (value === null || value === undefined ? '' : String(value)),
	today: '2026-11-16'
};

const is = (f: FieldDef, cell: unknown, op: Condition['op'], value?: Condition['value']): boolean =>
	meets(f, cell, { field: f.id, op, value }, read);

describe('conditions per kind', () => {
	it('reads text case-blind', () => {
		const note = field('note', 'text');
		expect(is(note, 'Bench press', 'contains', 'BENCH')).toBe(true);
		expect(is(note, 'Bench press', 'not-contains', 'squat')).toBe(true);
		expect(is(note, 'Bench press', 'starts', 'bench')).toBe(true);
		expect(is(note, 'Bench press', 'ends', 'PRESS')).toBe(true);
		expect(is(note, ' Dips ', 'is', 'dips')).toBe(true);
		expect(is(note, 'Dips', 'is-not', 'dips')).toBe(false);
		expect(is(note, '', 'empty')).toBe(true);
		expect(is(note, null, 'filled')).toBe(false);
	});

	it('compares numbers, a blank never in range', () => {
		const kg = field('kg', 'number');
		expect(is(kg, 80, 'gt', 70)).toBe(true);
		expect(is(kg, 80, 'gte', 80)).toBe(true);
		expect(is(kg, 80, 'lt', 80)).toBe(false);
		expect(is(kg, 9.5, 'lte', '9.5')).toBe(true);
		expect(is(kg, 80, 'between', [70, 90])).toBe(true);
		expect(is(kg, 95, 'not-between', [70, 90])).toBe(true);
		expect(is(kg, null, 'gt', 0)).toBe(false);
		expect(is(kg, null, 'between', [0, 1])).toBe(false);
		expect(is(kg, null, 'not-between', [0, 1])).toBe(false);
		expect(is(kg, 80, 'is', 80)).toBe(true);
	});

	it('reads dates as days, relative ones from today', () => {
		const day = field('day', 'date');
		expect(is(day, '2026-11-16', 'is', 'today')).toBe(true);
		expect(is(day, '2026-11-15', 'is', 'yesterday')).toBe(true);
		expect(is(day, '2026-11-10', 'is', 'past-week')).toBe(true);
		expect(is(day, '2026-11-08', 'is', 'past-week')).toBe(false);
		expect(is(day, '2026-11-08', 'before', 'past-week')).toBe(true);
		expect(is(day, '2026-05-07', 'after', '2025-12-01')).toBe(true);
		expect(is(day, '2026-05-07', 'between', ['2026-05-01', '2026-05-31'])).toBe(true);
		const at = field('at', 'datetime');
		expect(is(at, '2026-11-16T08:30', 'is', '2026-11-16')).toBe(true);
		expect(daySpan('past-month', '2026-03-31')).toEqual({ from: '2026-02-28', to: '2026-03-31' });
	});

	it('picks choices, links and checks from a list', () => {
		const status = field('status', 'choice');
		expect(is(status, 'watched', 'any-of', ['Watched', 'abandoned'])).toBe(true);
		expect(is(status, 'to watch', 'none-of', ['watched'])).toBe(true);
		const tags = field('tags', 'choices');
		expect(is(tags, ['a', 'b'], 'any-of', ['b'])).toBe(true);
		expect(is(tags, ['a', 'b'], 'none-of', ['b'])).toBe(false);
		const lift = field('lift', 'link');
		expect(is(lift, 'r_1', 'any-of', ['r_1'])).toBe(true);
		const done = field('done', 'check');
		expect(is(done, true, 'checked')).toBe(true);
		expect(is(done, null, 'unchecked')).toBe(true);
	});

	it('types a formula by its result', () => {
		expect(kindOf(field('f', 'formula', { result: 'date' }))).toBe('date');
		expect(kindOf(field('f', 'formula', { result: 'currency' }))).toBe('number');
		expect(OPS_OF[kindOf(field('f', 'formula'))]).toContain('contains');
		const plain = field('f', 'formula');
		expect(is(plain, 12, 'gt', '9')).toBe(true);
		expect(is(plain, 'abc', 'contains', 'B')).toBe(true);
	});
});

function rows(...data: Record<string, unknown>[]): Rec[] {
	return data.map((set, at) => ({
		id: `r${at}`,
		kind: 'row',
		base: 'b',
		parent: 't',
		data: set as Rec['data'],
		clocks: {}
	}));
}

describe('a set of conditions', () => {
	const kg = field('kg', 'number');
	const name = field('name', 'text');
	const fields = new Map([kg, name].map((f) => [f.id, f]));
	const cells = (row: Rec, f: FieldDef): unknown => row.data[f.id];
	const sets = rows(
		{ kg: 80, name: 'bench' },
		{ kg: 60, name: 'bench' },
		{ kg: 90, name: 'squat' }
	);

	it('keeps rows meeting all, leaves out unknown fields and unfinished ones', () => {
		const test = conditionTest(
			fields,
			[
				{ field: 'kg', op: 'gte', value: 70 },
				{ field: 'name', op: 'is', value: 'bench' },
				{ field: 'gone', op: 'is', value: 'x' },
				{ field: 'kg', op: 'gt' }
			],
			cells,
			read,
			() => new Map()
		);
		expect(sets.filter((row) => test(row)).map((row) => row.id)).toEqual(['r0']);
	});

	it('reads a custom formula row by row', () => {
		const test = conditionTest(
			fields,
			[{ field: null, op: 'formula', value: '{{kg}} > 70' }],
			cells,
			read,
			() =>
				new Map<string, unknown>([
					['r0', 1],
					['r1', 0],
					['r2', 'true']
				])
		);
		expect(sets.filter((row) => test(row)).map((row) => row.id)).toEqual(['r0', 'r2']);
	});
});

describe('colour rules', () => {
	const status = field('status', 'choice', {
		choices: [
			{ name: 'watched', color: 'amber' },
			{ name: 'later', color: null }
		]
	});
	const rating = field('rating', 'number');
	const fields = new Map([status, rating].map((f) => [f.id, f]));
	const cells = (row: Rec, f: FieldDef): unknown => row.data[f.id];
	const movies = rows(
		{ status: 'watched', rating: 9 },
		{ status: 'watched', rating: 3 },
		{ status: 'later', rating: 6 }
	);

	it('gives the first matching rule', () => {
		const rules: ColorRule[] = [
			{ when: { field: 'rating', op: 'lt', value: 5 }, color: 'red' },
			{ choices: 'status' }
		];
		const paint = colorTest(fields, rules, cells, read, () => new Map(), movies);
		expect(movies.map((row) => paint(row).color)).toEqual(['amber', 'red', null]);
	});

	it('scales a field over the shown rows', () => {
		const paint = colorTest(
			fields,
			[{ scale: 'rating', color: 'green' }],
			cells,
			read,
			() => new Map(),
			movies
		);
		expect(movies.map((row) => paint(row).scales.get('rating')?.step)).toEqual([5, 1, 3]);
		expect(paint(movies[0]).color).toBeNull();
		expect(scaleStep(4, 4, 4)).toBe(5);
	});
});

describe('totals', () => {
	it('sums, averages and bounds numbers', () => {
		const cells = [80, 70, null, 30];
		expect(totalOf('sum', cells)).toBe(180);
		expect(totalOf('avg', cells)).toBe(60);
		expect(totalOf('min', cells)).toBe(30);
		expect(totalOf('max', cells)).toBe(80);
		expect(totalOf('count', cells)).toBe(3);
		expect(totalOf('sum', [null])).toBeNull();
	});

	it('gives dates their first and last day and checks their share', () => {
		expect(totalOf('min', ['2026-05-07', '2025-12-29'])).toBe('2025-12-29');
		expect(totalOf('checked', [true, false, null, true])).toBe(0.5);
		expect(totalOf('count', [true, false, null])).toBe(1);
		expect(totalsFor(field('d', 'check'))).toEqual(['checked', 'count']);
		expect(totalsFor(field('d', 'date'))).toEqual(['min', 'max', 'count']);
	});
});
