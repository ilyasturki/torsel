import { describe, expect, it } from 'vitest';

import { createBase, createTable, insertRows, reorder } from '#lib/core/actions.ts';
import { Hlc } from '#lib/core/clock.ts';
import type { Change } from '#lib/core/model.ts';
import { parseNumber } from '#lib/core/values.ts';
import { Workspace } from '#lib/core/workspace.ts';

import {
	cellReader,
	clearChanges,
	copyText,
	fillSelection,
	fitWidth,
	gridRows,
	parseTsv,
	pasteChanges,
	sampleRows,
	toTsv
} from './grid.ts';

function fixture() {
	const ws = new Workspace();
	const hlc = new Hlc('test');
	const commit = (changes: Change[]): void => {
		for (const change of changes) ws.stamp(change, hlc.tick());
	};
	const base = createBase(ws, 'Base');
	commit(base.changes);
	const target = createTable(ws, base.id, 'Exercises', [{ name: 'Name', type: 'text' }]);
	commit(target.changes);
	commit(insertRows(ws, target.id, [{ [target.fieldIds[0]]: 'Squat' }]).changes);
	const table = createTable(ws, base.id, 'Lifts', [
		{ name: 'Note', type: 'text' },
		{ name: 'Kg', type: 'number' },
		{ name: 'Day', type: 'date' },
		{ name: 'Style', type: 'choice', choices: [{ name: 'Strict', color: 'blue' }] },
		{ name: 'Lift', type: 'link', target: target.id },
		{ name: 'Done', type: 'check' },
		{ name: 'Sum', type: 'formula', expr: '1' }
	]);
	commit(table.changes);
	const [note, kg, day, style, lift, done, sum] = ws.fields(table.id);
	return { ws, commit, tableId: table.id, target, note, kg, day, style, lift, done, sum };
}

describe('tsv', () => {
	it('keeps blank lines and cells, so a paste lines up by position', () => {
		expect(parseTsv('a\t\tb\n\nc\r\n')).toEqual([['a', '', 'b'], [''], ['c']]);
	});

	it('reads the quoted cells a sheet writes for tabs and line breaks', () => {
		expect(parseTsv('"two\nlines"\t"say ""hi"""')).toEqual([['two\nlines', 'say "hi"']]);
	});

	it('writes what it reads', () => {
		const cells = [
			['plain', 'with\ttab'],
			['two\nlines', 'say "hi"']
		];
		expect(parseTsv(toTsv(cells))).toEqual(cells);
	});
});

describe('copying a cell', () => {
	it('gives a sheet raw values', () => {
		const { ws, kg, day, done, lift, target } = fixture();
		const row = ws.rows(target.id)[0];
		expect(copyText(ws, kg, 1234567.25)).toBe('1234567.25');
		expect(copyText(ws, day, '2026-10-30')).toBe('2026-10-30');
		expect(copyText(ws, done, true)).toBe('TRUE');
		expect(copyText(ws, lift, row.id)).toBe('Squat');
		expect(copyText(ws, kg, null)).toBe('');
	});
});

describe('reading a cell', () => {
	it('reads each type, and refuses what is not one', () => {
		const { ws, note, kg, day, style, lift, done, sum, target } = fixture();
		const read = cellReader(ws);
		expect(read(note, ' spaced ')).toBe(' spaced ');
		expect(read(kg, '1,5')).toBe(1.5);
		expect(read(kg, 'heavy')).toBeUndefined();
		expect(read(day, '30/10/2026')).toBe('2026-10-30');
		expect(read(day, '30/10')).toBe(`${new Date().getFullYear()}-10-30`);
		expect(read(day, 'soon')).toBeUndefined();
		expect(read(style, 'strict')).toBe('Strict');
		expect(read(style, 'Tempo')).toBe('Tempo');
		expect(read(lift, 'squat')).toBe(ws.rows(target.id)[0].id);
		expect(read(lift, 'Bench')).toBeUndefined();
		expect(read(done, 'TRUE')).toBe(true);
		expect(read(done, 'maybe')).toBeUndefined();
		expect(read(sum, '3')).toBeUndefined();
		expect(read(kg, '  ')).toBeNull();
	});
});

describe('parseNumber', () => {
	it('reads the display text a sheet copies', () => {
		expect(parseNumber('1,234.5')).toBe(1234.5);
		expect(parseNumber('1.234,5')).toBe(1234.5);
		expect(parseNumber('1,234,567')).toBe(1234567);
		expect(parseNumber('1 234,5')).toBe(1234.5);
		expect(parseNumber('12,5')).toBe(12.5);
		expect(parseNumber('1,234')).toBe(1.234);
		expect(parseNumber('1.2.3')).toBeNull();
		expect(parseNumber('1,234,5')).toBeNull();
	});
});

describe('pasting', () => {
	it('overwrites from a cell, adds past the end and counts what does not fit', () => {
		const { ws, commit, tableId, note, kg, style, sum } = fixture();
		commit(insertRows(ws, tableId, [{ [note.id]: 'one' }], 1000).changes);
		const fields = [note, kg, style, sum];

		const paste = pasteChanges(ws, tableId, fields, ws.rows(tableId), { row: 0, col: 0 }, [
			['first', '10', 'Tempo'],
			['second', 'x', 'tempo'],
			['third', '30', '', '99', 'off the edge']
		]);
		commit(paste.changes);

		expect(paste.added).toBe(2);
		expect(paste.skipped).toBe(3);
		expect(paste.rows).toBe(3);
		expect(paste.cols).toBe(4);
		const rows = ws.rows(tableId);
		expect(rows.map((row) => row.data[note.id])).toEqual(['first', 'second', 'third']);
		expect(rows.map((row) => row.data[kg.id] ?? null)).toEqual([10, null, 30]);
		expect(ws.field(style.id)?.choices.map((choice) => choice.name)).toEqual(['Strict', 'Tempo']);
		expect(rows[1].data[style.id]).toBe('Tempo');
	});

	it('writes nothing for what already holds that value', () => {
		const { ws, commit, tableId, note } = fixture();
		commit(insertRows(ws, tableId, [{ [note.id]: 'same' }]).changes);
		const paste = pasteChanges(ws, tableId, [note], ws.rows(tableId), { row: 0, col: 0 }, [
			['same']
		]);
		expect(paste.changes).toEqual([]);
	});

	it('skips a blank line past the end instead of adding an empty row', () => {
		const { ws, tableId, note } = fixture();
		const paste = pasteChanges(ws, tableId, [note], [], { row: 0, col: 0 }, [['a'], [''], ['b']]);
		expect(paste.added).toBe(2);
	});

	it('fills a selection from one value only', () => {
		expect(fillSelection([['x']], 2, 2)).toEqual([
			['x', 'x'],
			['x', 'x']
		]);
		expect(fillSelection([['x', 'y']], 2, 2)).toEqual([['x', 'y']]);
		expect(fillSelection([['x']], 1, 1)).toEqual([['x']]);
	});
});

describe('clearing', () => {
	it('touches only the cells that hold something, and never a formula', () => {
		const { ws, commit, tableId, note, kg, sum } = fixture();
		commit(insertRows(ws, tableId, [{ [note.id]: 'a' }, {}]).changes);
		const changes = clearChanges(ws, [note, kg, sum], ws.rows(tableId));
		expect(changes).toHaveLength(1);
		expect(changes[0].set).toEqual({ [note.id]: null });
	});
});

describe('the rows a grid shows', () => {
	function numbered() {
		const made = fixture();
		const { ws, commit, tableId, note, kg } = made;
		commit(
			insertRows(ws, tableId, [
				{ [note.id]: 'b', [kg.id]: 2 },
				{ [note.id]: 'a' },
				{ [note.id]: 'c10', [kg.id]: 10 },
				{ [note.id]: 'c9', [kg.id]: 9 }
			]).changes
		);
		return {
			...made,
			notes: (config: Parameters<typeof gridRows>[2]) =>
				gridRows(ws, tableId, config, new Map()).map((row) => row.data[note.id])
		};
	}

	it('runs oldest first, so a new row lands at the end', () => {
		expect(numbered().notes({})).toEqual(['b', 'a', 'c10', 'c9']);
	});

	it('sorts numbers and text naturally with blanks last either way', () => {
		const { notes, kg, note } = numbered();
		expect(notes({ sort: { field: kg.id, dir: 'asc' } })).toEqual(['b', 'c9', 'c10', 'a']);
		expect(notes({ sort: { field: kg.id, dir: 'desc' } })).toEqual(['c10', 'c9', 'b', 'a']);
		expect(notes({ sort: { field: note.id, dir: 'asc' } })).toEqual(['a', 'b', 'c9', 'c10']);
	});

	it('ignores a sort or filter on a field that is gone', () => {
		const { notes } = numbered();
		expect(
			notes({ sort: { field: 'f_gone', dir: 'asc' }, filter: { field: 'f_gone', text: 'x' } })
		).toEqual(['b', 'a', 'c10', 'c9']);
	});

	it('filters on what the cell reads as', () => {
		const { notes, note, kg } = numbered();
		expect(notes({ filter: { field: note.id, text: 'C' } })).toEqual(['c10', 'c9']);
		expect(notes({ filter: { field: kg.id, text: '10' } })).toEqual(['c10']);
	});
});

describe('fitting a column', () => {
	const measure = {
		body: (text: string) => text.length * 7,
		header: (text: string) => text.length * 6
	};

	it('follows the widest value, stays under the ceiling and leaves the header readable', () => {
		const { note, kg, done } = fixture();
		expect(fitWidth(note, ['x'.repeat(20)], measure)).toBe(166);
		expect(fitWidth(note, ['x'.repeat(200)], measure)).toBe(320);
		expect(fitWidth({ ...kg, name: 'A very long header' }, ['1'], measure)).toBe(152);
		expect(fitWidth(done, ['yes'], measure)).toBe(68);
	});

	it('gives an empty column room to type in', () => {
		const { note } = fixture();
		expect(fitWidth(note, ['', ''], measure)).toBe(180);
	});

	it('samples across the whole table', () => {
		const { ws, commit, tableId, note } = fixture();
		commit(
			insertRows(
				ws,
				tableId,
				Array.from({ length: 1000 }, (_, index) => ({ [note.id]: `r${index}` }))
			).changes
		);
		const sample = sampleRows(ws.rows(tableId));
		expect(sample).toHaveLength(200);
		expect(sample[199].data[note.id]).toBe('r995');
	});
});

describe('reorder', () => {
	it('moves only what changes place', () => {
		const { ws, commit, note, kg, day } = fixture();
		const changes = reorder(ws, [note.id, day.id, kg.id]);
		expect(changes.map((change) => change.id)).toEqual([day.id, kg.id]);
		commit(changes);
		expect(
			ws
				.fields(note.table)
				.slice(0, 3)
				.map((field) => field.id)
		).toEqual([note.id, day.id, kg.id]);
	});
});
