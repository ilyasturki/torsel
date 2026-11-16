import names from '#lib/i18n/names.ts';
import { localeFormats } from '#lib/client/format.ts';
import { describe, expect, it } from 'vitest';

import {
	addField,
	createBase,
	createTable,
	defaultViews,
	insertRows,
	reorder
} from '#lib/core/actions.ts';
import { Hlc } from '#lib/core/clock.ts';
import { guessColumns, parseCells, parseCsv, toCsv } from '#lib/core/csv.ts';
import type { Change, FieldDef } from '#lib/core/model.ts';
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
	summarize,
	toHtml,
	toTsv,
	viewCells
} from './grid.ts';

function fixture() {
	const ws = new Workspace();
	const hlc = new Hlc('test');
	const commit = (changes: Change[]): void => {
		for (const change of changes) ws.stamp(change, hlc.tick());
	};
	const base = createBase(ws, 'Base');
	commit(base.changes);
	const target = createTable(ws, base.id, 'Exercises', [{ name: 'Name', type: 'text' }], () =>
		defaultViews(names.en)
	);
	commit(target.changes);
	commit(insertRows(ws, target.id, [{ [target.fieldIds[0]]: 'Squat' }]).changes);
	const table = createTable(
		ws,
		base.id,
		'Lifts',
		[
			{ name: 'Note', type: 'text' },
			{ name: 'Kg', type: 'number' },
			{ name: 'Day', type: 'date' },
			{ name: 'Style', type: 'choice', choices: [{ name: 'Strict', color: 'blue' }] },
			{ name: 'Lift', type: 'link', target: target.id },
			{ name: 'Done', type: 'check' },
			{ name: 'Sum', type: 'formula', expr: '1' }
		],
		() => defaultViews(names.en)
	);
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

describe('html', () => {
	it('writes a table a document pastes, its text escaped', () => {
		expect(
			toHtml([
				['a<b', 'say "hi"'],
				['two\nlines', '&']
			])
		).toBe(
			'<table><tr><td>a&#60;b</td><td>say &#34;hi&#34;</td></tr><tr><td>two<br>lines</td><td>&#38;</td></tr></table>'
		);
	});
});

describe('the sum of a selection', () => {
	it('sums, averages and counts the numbers only, with their field when it is one', () => {
		const { ws, commit, tableId, note, kg, done } = fixture();
		commit(
			insertRows(ws, tableId, [
				{ [note.id]: 'a', [kg.id]: 10, [done.id]: true },
				{ [note.id]: 'b', [kg.id]: 25 },
				{ [note.id]: 'c' }
			]).changes
		);
		const rows = ws.rows(tableId);
		expect(summarize(rows, [note, kg, done], new Map())).toEqual({
			sum: 35,
			average: 17.5,
			count: 2,
			field: kg
		});
		expect(summarize(rows, [note, done], new Map())).toBeNull();
	});
});

describe('exporting a view', () => {
	it('quotes what a CSV reader would split on, and reads back as it was', () => {
		const cells = [
			['Note', 'Kg'],
			['a, b', '12.5'],
			['two\nlines', 'say "hi"'],
			['', '']
		];
		const text = toCsv(cells);
		expect(text).toBe('Note,Kg\r\n"a, b",12.5\r\n"two\nlines","say ""hi"""\r\n,\r\n');
		expect(parseCells(text, ',')).toEqual(cells);
	});

	it('writes the shown columns and rows in the view order, numbers with a dot', () => {
		const { ws, commit, tableId, note, kg, day, done, lift, target } = fixture();
		const squat = ws.rows(target.id)[0].id;
		commit(
			insertRows(ws, tableId, [
				{ [note.id]: 'light', [kg.id]: 1234.5, [day.id]: '2026-10-30', [lift.id]: squat },
				{ [note.id]: 'heavy', [kg.id]: 140, [done.id]: true },
				{ [note.id]: 'skipped' }
			]).changes
		);
		const view = ws.views(tableId).find((item) => item.type === 'grid');
		if (view === undefined) throw new Error('no grid view');
		const config = {
			hidden: [ws.fields(tableId).find((field) => field.name === 'Style')?.id ?? ''],
			sort: [{ field: kg.id, dir: 'desc' as const }],
			filters: [{ field: note.id, op: 'contains' as const, value: 'h' }]
		};
		const computed = new Map([[ws.rows(tableId)[1].id, { [ws.fields(tableId)[6].id]: 2 }]]);

		expect(viewCells(ws, tableId, { ...view, config }, computed)).toEqual([
			['Note', 'Kg', 'Day', 'Lift', 'Done', 'Sum'],
			['light', '1234.5', '2026-10-30', 'Squat', '', ''],
			['heavy', '140', '', '', 'TRUE', '2']
		]);
	});

	it('writes each type so a file import reads it back as that type', () => {
		const { ws, commit, tableId } = fixture();
		const specs = [
			{ name: 'Price', type: 'currency', currency: 'USD' },
			{ name: 'Share', type: 'percent' },
			{ name: 'Rest', type: 'duration', seconds: true },
			{ name: 'Seen', type: 'datetime' },
			{ name: 'Tags', type: 'choices' }
		] as const;
		const [price, share, rest, seen, tags] = specs.map((spec) => {
			const made = addField(ws, tableId, spec);
			commit(made.changes);
			return made.id;
		});
		commit(
			insertRows(ws, tableId, [
				{
					[price]: 12.5,
					[share]: 40,
					[rest]: 90,
					[seen]: '2026-11-03T18:30',
					[tags]: ['Drama', 'Noir']
				},
				{
					[price]: 3,
					[share]: 2.5,
					[rest]: 3600,
					[seen]: '2026-11-04T07:00',
					[tags]: ['Noir', 'Heist']
				},
				{ [tags]: ['Drama'] }
			]).changes
		);
		const view = ws.views(tableId).find((item) => item.type === 'grid');
		if (view === undefined) throw new Error('no grid view');

		const cells = viewCells(ws, tableId, view, new Map());
		const columns = guessColumns(parseCsv(toCsv(cells)), names.en).slice(-5);
		expect(columns.map((column) => column.type)).toEqual([
			'currency',
			'percent',
			'duration',
			'datetime',
			'choices'
		]);
		expect(columns[0].currency).toBe('USD');
		expect(cells[1].slice(-5)).toEqual([
			'12.5 USD',
			'40%',
			'0:01:30',
			'2026-11-03T18:30',
			'Drama, Noir'
		]);
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
		const read = cellReader(ws, localeFormats('en-GB'));
		expect(read(note, ' spaced ')).toBe(' spaced ');
		expect(read(kg, '1,5')).toBe(1.5);
		expect(read(kg, 'heavy')).toBeUndefined();
		expect(read(day, '30/10/2026')).toBe('2026-10-30');
		expect(read(day, '30/10')).toBe(`${new Date().getFullYear()}-10-30`);
		expect(read(day, 'soon')).toBeUndefined();
		expect(cellReader(ws, localeFormats('en-US'))(day, '10/30/2026')).toBe('2026-10-30');
		expect(cellReader(ws, localeFormats('en-US'))(kg, '2,024')).toBe(2024);
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

	it('keeps locked cells and adds no row where rows come from a source', () => {
		const { ws, commit, tableId, note, kg } = fixture();
		commit(insertRows(ws, tableId, [{ [note.id]: 'one', [kg.id]: 5 }]).changes);
		const paste = pasteChanges(
			ws,
			tableId,
			[note, kg],
			ws.rows(tableId),
			{ row: 0, col: 0 },
			[
				['first', '10'],
				['second', '20']
			],
			{ locked: new Set([note.id]), adds: false }
		);
		commit(paste.changes);

		expect(paste.kept).toBe(3);
		expect(paste.added).toBe(0);
		const rows = ws.rows(tableId);
		expect(rows.map((row) => [row.data[note.id], row.data[kg.id]])).toEqual([['one', 10]]);
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

describe('pasting into a field nobody typed', () => {
	function blankField() {
		const { ws, commit, tableId } = fixture();
		const made = addField(ws, tableId, { name: 'Fresh', type: 'text', auto: true });
		commit(made.changes);
		commit(insertRows(ws, tableId, [{}, {}]).changes);
		return { ws, commit, tableId, id: made.id, fields: [ws.field(made.id) as FieldDef] };
	}

	it('settles once, on the whole column', () => {
		const { ws, commit, tableId, id, fields } = blankField();
		const paste = pasteChanges(ws, tableId, fields, ws.rows(tableId), { row: 0, col: 0 }, [
			['heavy'],
			['100']
		]);

		expect(paste.changes.filter((change) => change.id === id)).toHaveLength(1);
		commit(paste.changes);
		expect(ws.field(id)?.type).toBe('text');
		expect(ws.rows(tableId).map((row) => row.data[id])).toEqual(['heavy', '100']);
	});

	it('takes a number when every pasted value is one, past the last row too', () => {
		const { ws, commit, tableId, id, fields } = blankField();
		const paste = pasteChanges(ws, tableId, fields, ws.rows(tableId), { row: 0, col: 0 }, [
			['1'],
			['2,5'],
			['3']
		]);

		expect(paste.added).toBe(1);
		commit(paste.changes);
		expect(ws.field(id)?.type).toBe('number');
		expect(
			ws
				.rows(tableId)
				.map((row) => row.data[id])
				.sort()
		).toEqual([1, 2.5, 3]);
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
		expect(notes({ sort: [{ field: kg.id, dir: 'asc' }] })).toEqual(['b', 'c9', 'c10', 'a']);
		expect(notes({ sort: [{ field: kg.id, dir: 'desc' }] })).toEqual(['c10', 'c9', 'b', 'a']);
		expect(notes({ sort: [{ field: note.id, dir: 'asc' }] })).toEqual(['a', 'b', 'c9', 'c10']);
	});

	it('breaks ties with each next sort key', () => {
		const { ws, commit, tableId, notes, kg, note } = numbered();
		commit(insertRows(ws, tableId, [{ [note.id]: 'a2', [kg.id]: 9 }]).changes);
		expect(
			notes({
				sort: [
					{ field: kg.id, dir: 'desc' },
					{ field: note.id, dir: 'asc' }
				]
			})
		).toEqual(['c10', 'a2', 'c9', 'b', 'a']);
		expect(
			notes({
				sort: [
					{ field: kg.id, dir: 'desc' },
					{ field: note.id, dir: 'desc' }
				]
			})
		).toEqual(['c10', 'c9', 'a2', 'b', 'a']);
	});

	it('ignores a sort or filter on a field that is gone, or a sort of another shape', () => {
		const { notes } = numbered();
		expect(
			notes({
				sort: [{ field: 'f_gone', dir: 'asc' }],
				filters: [{ field: 'f_gone', op: 'contains', value: 'x' }]
			})
		).toEqual(['b', 'a', 'c10', 'c9']);
		expect(
			notes({ sort: { field: 'f_gone', dir: 'asc' } } as unknown as Parameters<typeof notes>[0])
		).toEqual(['b', 'a', 'c10', 'c9']);
	});

	it('filters on what the cell reads as', () => {
		const { notes, note, kg } = numbered();
		expect(notes({ filters: [{ field: note.id, op: 'contains', value: 'C' }] })).toEqual([
			'c10',
			'c9'
		]);
		expect(notes({ filters: [{ field: kg.id, op: 'contains', value: '10' }] })).toEqual(['c10']);
	});

	it('keeps the rows meeting every filter', () => {
		const { notes, note, kg } = numbered();
		expect(
			notes({
				filters: [
					{ field: note.id, op: 'starts', value: 'c' },
					{ field: kg.id, op: 'gt', value: 9.5 }
				]
			})
		).toEqual(['c10']);
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

	it('fits every star of a rating and every chip of several choices', () => {
		const { note } = fixture();
		expect(fitWidth({ ...note, type: 'rating', max: 10 }, [''], measure)).toBe(176);
		expect(fitWidth({ ...note, type: 'rating', name: 'A long score header' }, [''], measure)).toBe(
			158
		);
		expect(fitWidth({ ...note, type: 'choices' }, ['Epic, Desert'], measure)).toBe(84 + 32 + 26);
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

describe('pasting into a currency column', () => {
	it('refuses an amount in another currency and names the column currency', () => {
		const { ws, commit, tableId } = fixture();
		const made = addField(ws, tableId, { name: 'Price', type: 'currency', currency: 'EUR' });
		commit(made.changes);
		commit(insertRows(ws, tableId, [{ [made.id]: 34 }, {}]).changes);
		const price = ws.field(made.id) as FieldDef;

		const paste = pasteChanges(ws, tableId, [price], ws.rows(tableId), { row: 0, col: 0 }, [
			['$12'],
			['14']
		]);

		expect(paste.foreign).toBe('EUR');
		expect(paste.skipped).toBe(1);
		commit(paste.changes);
		expect(ws.rows(tableId).map((row) => row.data[made.id])).toEqual([34, 14]);
	});

	it('names nothing when every amount is in the column currency', () => {
		const { ws, commit, tableId } = fixture();
		const made = addField(ws, tableId, { name: 'Price', type: 'currency', currency: 'EUR' });
		commit(made.changes);
		const price = ws.field(made.id) as FieldDef;

		const paste = pasteChanges(ws, tableId, [price], [], { row: 0, col: 0 }, [['12 €'], ['3']]);

		expect(paste.foreign).toBeNull();
		expect(paste.skipped).toBe(0);
	});
});
