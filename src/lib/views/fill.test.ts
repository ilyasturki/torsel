import names from '#lib/i18n/names.ts';
import { describe, expect, it } from 'vitest';

import { createBase, createTable, defaultViews, insertRows } from '#lib/core/actions.ts';
import { Hlc } from '#lib/core/clock.ts';
import type { Change, Value } from '#lib/core/model.ts';
import { Workspace } from '#lib/core/workspace.ts';

import { fillChanges, fillTarget, nextValues } from './fill.ts';

describe('series', () => {
	it('copies one number and continues two', () => {
		expect(nextValues('number', [5], 3)).toEqual([5, 5, 5]);
		expect(nextValues('number', [1, 2], 3)).toEqual([3, 4, 5]);
		expect(nextValues('number', [10, 7.5], 2)).toEqual([5, 2.5]);
		expect(nextValues('number', [0.1, 0.2], 2)).toEqual([0.3, 0.4]);
	});

	it('repeats cells that hold no steady step', () => {
		expect(nextValues('number', [1, 2, 4], 4)).toEqual([1, 2, 4, 1]);
		expect(nextValues('number', [1, null], 3)).toEqual([1, null, 1]);
		expect(nextValues('choice', ['Strict', 'Tempo'], 3)).toEqual(['Strict', 'Tempo', 'Strict']);
		expect(nextValues('check', [true], 2)).toEqual([true, true]);
		expect(nextValues(null, [1, 2], 2)).toEqual([1, 2]);
	});

	it('moves one date on by a day, and dates by the step they show', () => {
		expect(nextValues('date', ['2026-02-27'], 3)).toEqual([
			'2026-02-28',
			'2026-03-01',
			'2026-03-02'
		]);
		expect(nextValues('date', ['2026-01-05', '2026-01-12'], 2)).toEqual([
			'2026-01-19',
			'2026-01-26'
		]);
		expect(nextValues('date', ['2026-11-03T18:30', '2026-11-03T19:00'], 2)).toEqual([
			'2026-11-03T19:30',
			'2026-11-03T20:00'
		]);
	});

	it('keeps the day of the month when the dates step by months', () => {
		expect(nextValues('date', ['2026-01-31', '2026-02-28'], 1)).toEqual(['2026-03-28']);
		expect(nextValues('date', ['2025-12-31', '2026-01-31'], 2)).toEqual([
			'2026-02-28',
			'2026-03-31'
		]);
		expect(nextValues('date', ['2024-03-01', '2025-03-01'], 1)).toEqual(['2026-03-01']);
	});

	it('counts on from a number ending a text', () => {
		expect(nextValues('text', ['Set 1'], 2)).toEqual(['Set 2', 'Set 3']);
		expect(nextValues('text', ['A08', 'A10'], 2)).toEqual(['A12', 'A14']);
		expect(nextValues('text', ['Squat'], 2)).toEqual(['Squat', 'Squat']);
		expect(nextValues('text', ['Set 1', 'Rep 2'], 2)).toEqual(['Set 1', 'Rep 2']);
	});

	it('continues every type held as a number, and a date and time', () => {
		expect(nextValues('currency', [9.5, 10], 2)).toEqual([10.5, 11]);
		expect(nextValues('percent', [10, 20], 1)).toEqual([30]);
		expect(nextValues('duration', [600, 1200], 1)).toEqual([1800]);
		expect(nextValues('rating', [1, 2], 2)).toEqual([3, 4]);
		expect(nextValues('datetime', ['2026-11-03T18:30'], 1)).toEqual(['2026-11-04T18:30']);
		expect(nextValues('choices', [['Drama', 'Noir']], 2)).toEqual([
			['Drama', 'Noir'],
			['Drama', 'Noir']
		]);
	});

	it('runs backwards from reversed cells', () => {
		expect(nextValues('number', [3, 2], 2)).toEqual([1, 0]);
	});
});

function fixture() {
	const ws = new Workspace();
	const hlc = new Hlc('test');
	const commit = (changes: Change[]): void => {
		for (const change of changes) ws.stamp(change, hlc.tick());
	};
	const base = createBase(ws, 'Base');
	commit(base.changes);
	const table = createTable(
		ws,
		base.id,
		'Lifts',
		[
			{ name: 'Note', type: 'text' },
			{ name: 'Kg', type: 'number' },
			{ name: 'Day', type: 'date' },
			{ name: 'Style', type: 'choice', choices: [{ name: 'Strict', color: 'blue' }] },
			{ name: 'Sum', type: 'formula', expr: '1' }
		],
		() => defaultViews(names.en)
	);
	commit(table.changes);
	const fields = ws.fields(table.id);
	const [note, kg, day] = fields;
	commit(
		insertRows(
			ws,
			table.id,
			Array.from({ length: 5 }, (_, index) => ({
				[note.id]: index === 0 ? 'Set 1' : null,
				[kg.id]: index < 2 ? (index + 1) * 20 : null,
				[day.id]: index === 0 ? '2026-11-03' : null
			}))
		).changes
	);
	const column = (at: number): Value[] =>
		ws.rows(table.id).map((row) => row.data[fields[at].id] ?? null);
	return { ws, commit, tableId: table.id, fields, column };
}

describe('filling', () => {
	it('continues each column down in one set of changes, past formulas', () => {
		const { ws, commit, tableId, fields, column } = fixture();
		const fill = fillChanges(
			ws,
			tableId,
			fields,
			ws.rows(tableId),
			new Map(),
			{ top: 0, bottom: 1, left: 1, right: 4 },
			{ top: 2, bottom: 4, left: 1, right: 4 }
		);
		commit(fill.changes);

		expect(column(1)).toEqual([20, 40, 60, 80, 100]);
		expect(column(2)).toEqual(['2026-11-03', null, '2026-11-03', null, '2026-11-03']);
		expect(fill.cells).toBe(9);
	});

	it('leaves locked cells as they are', () => {
		const { ws, commit, tableId, fields, column } = fixture();
		const fill = fillChanges(
			ws,
			tableId,
			fields,
			ws.rows(tableId),
			new Map(),
			{ top: 0, bottom: 1, left: 1, right: 2 },
			{ top: 2, bottom: 4, left: 1, right: 2 },
			true,
			new Set([fields[1].id])
		);
		commit(fill.changes);

		expect(column(1)).toEqual([20, 40, null, null, null]);
		expect(column(2)).toEqual(['2026-11-03', null, '2026-11-03', null, '2026-11-03']);
		expect(fill.cells).toBe(3);
	});

	it('copies instead when asked, and upward from the top of the box', () => {
		const { ws, commit, tableId, fields, column } = fixture();
		commit(
			fillChanges(
				ws,
				tableId,
				fields,
				ws.rows(tableId),
				new Map(),
				{ top: 0, bottom: 0, left: 0, right: 2 },
				{ top: 1, bottom: 2, left: 0, right: 2 },
				false
			).changes
		);
		expect(column(0)).toEqual(['Set 1', 'Set 1', 'Set 1', null, null]);
		expect(column(1)).toEqual([20, 20, 20, null, null]);

		commit(
			fillChanges(
				ws,
				tableId,
				fields,
				ws.rows(tableId),
				new Map(),
				{ top: 3, bottom: 4, left: 1, right: 1 },
				{ top: 0, bottom: 2, left: 1, right: 1 }
			).changes
		);
		expect(column(1)).toEqual([null, null, null, null, null]);
	});

	it('carries a value across into the fields it fits, adding a choice it names', () => {
		const { ws, commit, tableId, fields, column } = fixture();
		const rows = ws.rows(tableId);
		const fill = fillChanges(
			ws,
			tableId,
			fields,
			rows,
			new Map(),
			{ top: 0, bottom: 0, left: 0, right: 0 },
			{ top: 0, bottom: 0, left: 1, right: 3 }
		);
		commit(fill.changes);
		expect(column(1)[0]).toBe(20);
		expect(column(2)[0]).toBe('2026-11-03');
		expect(column(3)[0]).toBe('Set 1');
		expect(ws.field(fields[3].id)?.choices.map((choice) => choice.name)).toEqual([
			'Strict',
			'Set 1'
		]);
		expect(fill.cells).toBe(1);
	});
});

describe('the fill handle', () => {
	const from = { top: 2, bottom: 3, left: 1, right: 1 };
	const last = { top: 0, bottom: 9, left: 0, right: 4 };

	it('reaches the side the pointer went furthest past', () => {
		expect(fillTarget(from, { r: 6, c: 2 }, last)).toEqual({
			top: 4,
			bottom: 6,
			left: 1,
			right: 1
		});
		expect(fillTarget(from, { r: 3, c: 4 }, last)).toEqual({
			top: 2,
			bottom: 3,
			left: 2,
			right: 4
		});
		expect(fillTarget(from, { r: 0, c: 1 }, last)).toEqual({
			top: 0,
			bottom: 1,
			left: 1,
			right: 1
		});
		expect(fillTarget(from, { r: 3, c: 1 }, last)).toBeNull();
	});

	it('stops at the last row', () => {
		expect(fillTarget(from, { r: 40, c: 1 }, last)).toEqual({
			top: 4,
			bottom: 9,
			left: 1,
			right: 1
		});
		expect(fillTarget({ ...from, bottom: 9 }, { r: 10, c: 1 }, last)).toBeNull();
	});
});
