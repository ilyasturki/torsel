import { describe, expect, it } from 'vitest';

import {
	addField,
	blankTable,
	createBase,
	createTable,
	deleteRecords,
	entryFields,
	insertRows,
	listLayout,
	reorder,
	shifted,
	updateRow
} from './actions.ts';
import { exportOf, parseExport, restoreChanges } from './backup.ts';
import { Hlc } from './clock.ts';
import {
	NEW_FIELD,
	SKIP,
	appendRows,
	guessColumns,
	guessTargets,
	importTable,
	parseCsv,
	withHeader
} from './csv.ts';
import type { Change, Value } from './model.ts';
import { retypeField } from './retype.ts';
import { Workspace } from './workspace.ts';

function setup(): { ws: Workspace; apply: (changes: Change[]) => Change[] } {
	const ws = new Workspace();
	const hlc = new Hlc('a');
	return { ws, apply: (changes) => changes.map((change) => ws.stamp(change, hlc.tick()).inverse) };
}

function lifts() {
	const { ws, apply } = setup();
	const base = createBase(ws, 'Gym');
	apply(base.changes);
	const table = createTable(ws, base.id, 'Lifts', [
		{ name: 'Exercise', type: 'text' },
		{ name: 'Kg', type: 'text' }
	]);
	apply(table.changes);
	const [exercise, kg] = table.fieldIds;
	const { ids, changes } = insertRows(ws, table.id, [
		{ [exercise]: 'Squat', [kg]: '100' },
		{ [exercise]: 'Bench', [kg]: 'heavy' },
		{ [exercise]: 'Squat', [kg]: '82,5' }
	]);
	apply(changes);
	return { ws, apply, baseId: base.id, tableId: table.id, exercise, kg, ids };
}

describe('a field nobody typed', () => {
	function fresh() {
		const { ws, apply } = setup();
		const made = blankTable(ws);
		apply(made.changes);
		const { id, changes } = addField(ws, made.id, { name: 'Kg', type: 'text', auto: true });
		apply(changes);
		const rows = insertRows(ws, made.id, [{}]);
		apply(rows.changes);
		return { ws, apply, tableId: made.id, fieldId: id, rowId: rows.ids[0] };
	}

	it('becomes a number from its first number', () => {
		const { ws, apply, fieldId, rowId } = fresh();
		apply(updateRow(ws, rowId, { [fieldId]: '82,5' }));

		expect(ws.field(fieldId)?.type).toBe('number');
		expect(ws.field(fieldId)?.auto).toBe(false);
		expect(ws.live(rowId)?.data[fieldId]).toBe(82.5);
	});

	it('becomes a date from its first date', () => {
		const { ws, apply, fieldId, rowId } = fresh();
		apply(updateRow(ws, rowId, { [fieldId]: '30/10/2026' }));

		expect(ws.field(fieldId)?.type).toBe('date');
		expect(ws.live(rowId)?.data[fieldId]).toBe('2026-10-30');
	});

	it('stays text from a word, and stops guessing', () => {
		const { ws, apply, fieldId, rowId, tableId } = fresh();
		apply(updateRow(ws, rowId, { [fieldId]: 'heavy' }));
		expect(ws.field(fieldId)?.type).toBe('text');

		apply(insertRows(ws, tableId, [{ [fieldId]: '100' }]).changes);
		expect(ws.field(fieldId)?.type).toBe('text');
	});

	it('reads several rows at once, so one word keeps them all', () => {
		const { ws, apply, fieldId, tableId } = fresh();
		apply(insertRows(ws, tableId, [{ [fieldId]: '100' }, { [fieldId]: 'heavy' }]).changes);

		expect(ws.field(fieldId)?.type).toBe('text');
	});

	it('leaves a field with a chosen type alone', () => {
		const { ws, apply, tableId, rowId } = fresh();
		const { id, changes } = addField(ws, tableId, { name: 'Code', type: 'text' });
		apply(changes);
		apply(updateRow(ws, rowId, { [id]: '0612' }));

		expect(ws.field(id)?.type).toBe('text');
		expect(ws.live(rowId)?.data[id]).toBe('0612');
	});

	it('undoes back to no decision', () => {
		const { ws, apply, fieldId, rowId } = fresh();
		const inverse = apply(updateRow(ws, rowId, { [fieldId]: '100' }));
		apply([...inverse].reverse());

		expect(ws.field(fieldId)?.type).toBe('text');
		expect(ws.field(fieldId)?.auto).toBe(true);
	});
});

describe('changing a field type', () => {
	it('converts what it can, counts what it clears, and undoes in one step', () => {
		const { ws, apply, kg, ids } = lifts();
		const { changes, lost } = retypeField(ws, kg, { type: 'number' });
		expect(lost).toBe(1);

		const inverse = apply(changes);
		expect(ws.field(kg)?.type).toBe('number');
		expect(ids.map((id) => ws.live(id)?.data[kg])).toEqual([100, null, 82.5]);

		apply([...inverse].reverse());
		expect(ws.field(kg)?.type).toBe('text');
		expect(ids.map((id) => ws.live(id)?.data[kg])).toEqual(['100', 'heavy', '82,5']);
	});

	it('makes choices out of the values', () => {
		const { ws, apply, exercise } = lifts();
		apply(retypeField(ws, exercise, { type: 'choice' }).changes);

		expect(ws.field(exercise)?.choices.map((choice) => choice.name)).toEqual(['Squat', 'Bench']);
	});

	it('reads numbers and checks back as text', () => {
		const { ws, apply, tableId, ids } = lifts();
		const reps = addField(ws, tableId, { name: 'Reps', type: 'number' });
		const done = addField(ws, tableId, { name: 'Done', type: 'check' });
		apply([...reps.changes, ...done.changes]);
		apply(updateRow(ws, ids[0], { [reps.id]: 8, [done.id]: true }));

		apply(retypeField(ws, reps.id, { type: 'text' }).changes);
		apply(retypeField(ws, done.id, { type: 'text' }).changes);

		expect(ws.live(ids[0])?.data[reps.id]).toBe('8');
		expect(ws.live(ids[0])?.data[done.id]).toBe('yes');
	});

	it('finds linked rows by their title, and reads a link back as its title', () => {
		const { ws, apply, baseId, exercise, ids } = lifts();
		const names = createTable(ws, baseId, 'Exercises', [{ name: 'Name', type: 'text' }]);
		apply(names.changes);
		const squat = insertRows(ws, names.id, [{ [names.fieldIds[0]]: 'squat' }]);
		apply(squat.changes);

		const linked = retypeField(ws, exercise, { type: 'link', target: names.id });
		expect(linked.lost).toBe(1);
		apply(linked.changes);
		expect(ws.live(ids[0])?.data[exercise]).toBe(squat.ids[0]);
		expect(ws.live(ids[1])?.data[exercise]).toBe(null);

		apply(retypeField(ws, exercise, { type: 'text' }).changes);
		expect(ws.live(ids[0])?.data[exercise]).toBe('squat');
	});

	it('turns a formula into its current results, and values into a formula', () => {
		const { ws, apply, tableId, kg, ids } = lifts();
		const made = addField(ws, tableId, { name: 'Double', type: 'formula', expr: '1' });
		apply(made.changes);
		const computed = new Map<string, Record<string, Value>>([[ids[0], { [made.id]: 200 }]]);

		apply(retypeField(ws, made.id, { type: 'number' }, computed).changes);
		expect(ws.live(ids[0])?.data[made.id]).toBe(200);

		const { changes, lost } = retypeField(ws, kg, { type: 'formula', expr: '2' });
		expect(lost).toBe(0);
		apply(changes);
		expect(ws.field(kg)?.expr).toBe('2');
		expect(ws.live(ids[0])?.data[kg]).toBe(null);
	});
});

describe('reordering', () => {
	it('moves one place and writes only what moved', () => {
		const { ws, apply, tableId, exercise, kg } = lifts();
		const third = addField(ws, tableId, { name: 'Third', type: 'text' });
		apply(third.changes);

		const changes = reorder(ws, shifted([exercise, kg, third.id], third.id, -1));
		expect(changes.map((change) => change.id).sort()).toEqual([kg, third.id].sort());
		apply(changes);

		expect(ws.fields(tableId).map((field) => field.name)).toEqual(['Exercise', 'Third', 'Kg']);
	});

	it('stays put off either end', () => {
		expect(shifted(['a', 'b'], 'a', -1)).toEqual(['a', 'b']);
		expect(shifted(['a', 'b'], 'b', 1)).toEqual(['a', 'b']);
		expect(shifted(['a', 'b', 'c'], 'a', 1)).toEqual(['b', 'a', 'c']);
	});
});

describe('a list and its settings', () => {
	const { ws, apply, tableId, exercise, kg } = lifts();
	const when = addField(ws, tableId, { name: 'When', type: 'date' });
	apply(when.changes);
	const fields = ws.fields(tableId);

	it('resolves unset settings', () => {
		const { group, title, show } = listLayout(fields, {});
		expect(group?.id).toBe(when.id);
		expect(title?.id).toBe(exercise);
		expect(show.map((field) => field.id)).toEqual([kg]);
	});

	it('takes an explicit nothing for a group at its word', () => {
		const { group, show } = listLayout(fields, { group: null });
		expect(group).toBeUndefined();
		expect(show.map((field) => field.id)).toEqual([kg, when.id]);
	});
});

describe('importing', () => {
	const csv = [
		'date,exercise,kg,note',
		'2026-10-30,Bench,80,',
		'2026-10-30,Bench,82.5,',
		'2026-10-28,Squat,100,"seat 5, low"'
	].join('\r\n');

	it('leaves a header alone and numbers columns when the first row is data', () => {
		expect(withHeader(parseCsv('name\tkg\nSquat\t100', '\t'))[0]).toEqual(['name', 'kg']);
		expect(withHeader(parseCsv('Squat\t100\nBench\t80', '\t'))).toEqual([
			['Column 1', 'Column 2'],
			['Squat', '100'],
			['Bench', '80']
		]);
	});

	it('puts a new table in date order, one day keeping file order', () => {
		const { ws, apply } = setup();
		const base = createBase(ws, 'Gym');
		apply(base.changes);
		const rows = parseCsv(csv);
		const { id, changes } = importTable(ws, base.id, 'Lifts', rows);
		apply(changes);

		const kg = ws.fields(id).find((field) => field.name === 'kg');
		expect(ws.rows(id).map((row) => row.data[kg?.id ?? ''])).toEqual([100, 80, 82.5]);
	});

	it('maps columns by name, whatever their case and punctuation', () => {
		const { ws, tableId, exercise, kg } = lifts();
		const columns = guessColumns(parseCsv('EXERCISE,k_g,other\na,1,x'));

		expect(guessTargets(columns, ws.fields(tableId))).toEqual([exercise, kg, NEW_FIELD]);
	});

	it('appends through a mapping, adds new fields and new choices, and skips what it was told to', () => {
		const { ws, apply, tableId, exercise } = lifts();
		apply(retypeField(ws, exercise, { type: 'choice' }).changes);
		const before = ws.rows(tableId).length;
		const rows = parseCsv(csv);
		const columns = guessColumns(rows);

		const { changes, count, unread } = appendRows(
			ws,
			tableId,
			rows,
			columns,
			[NEW_FIELD, exercise, SKIP, SKIP],
			Date.now() + 1000
		);
		expect(count).toBe(3);
		expect(unread).toBe(0);

		const inverse = apply(changes);
		const date = ws.fields(tableId).find((field) => field.name === 'date');
		expect(date?.type).toBe('date');
		expect(ws.fields(tableId).at(-1)?.id).toBe(date?.id);
		expect(ws.rows(tableId)).toHaveLength(before + 3);
		expect(ws.rows(tableId).at(-1)?.data[date?.id ?? '']).toBe('2026-10-30');

		apply([...inverse].reverse());
		expect(ws.rows(tableId)).toHaveLength(before);
		expect(ws.fields(tableId).some((field) => field.name === 'date')).toBe(false);
	});

	it('counts the values a mapped field could not hold', () => {
		const { ws, apply, tableId, exercise } = lifts();
		const reps = addField(ws, tableId, { name: 'Reps', type: 'number' });
		apply(reps.changes);
		const rows = parseCsv('exercise,reps\nSquat,8\nBench,lots');
		const { unread } = appendRows(ws, tableId, rows, guessColumns(rows), [exercise, reps.id]);

		expect(unread).toBe(1);
	});

	it('fills a blank table: its starting column goes unless a column fills it', () => {
		const { ws, apply } = setup();
		const blank = blankTable(ws);
		apply(blank.changes);
		const rows = parseCsv(csv);
		const columns = guessColumns(rows);
		apply(
			appendRows(ws, blank.id, rows, columns, guessTargets(columns, ws.fields(blank.id))).changes
		);

		expect(ws.fields(blank.id).map((field) => field.name)).toEqual([
			'date',
			'exercise',
			'kg',
			'note'
		]);
		expect(ws.fields(blank.id)[2].type).toBe('number');
	});

	it('keeps a field someone added to a blank table, even unfilled', () => {
		const { ws, apply } = setup();
		const blank = blankTable(ws);
		apply(blank.changes);
		apply(addField(ws, blank.id, { name: 'Day', type: 'text', auto: true }).changes);
		const rows = parseCsv('kg\n1');
		const columns = guessColumns(rows);
		apply(
			appendRows(ws, blank.id, rows, columns, guessTargets(columns, ws.fields(blank.id))).changes
		);

		expect(ws.fields(blank.id).map((field) => field.name)).toEqual(['Day', 'kg']);
	});

	it('leaves the columns that never vary out of a new table’s entry view, and keeps later fields in', () => {
		const { ws, apply } = setup();
		const base = createBase(ws, 'Gym');
		apply(base.changes);
		const lines = Array.from({ length: 12 }, (_, set) => `Squat,${set},total,`);
		const { id, changes } = importTable(
			ws,
			base.id,
			'Lifts',
			parseCsv(['exercise,kg,mode,grip', ...lines].join('\n'))
		);
		apply(changes);
		apply(addField(ws, id, { name: 'Later', type: 'text' }).changes);

		const entry = ws.views(id).find((view) => view.type === 'entry');
		const names = entryFields(ws.fields(id), entry?.config ?? {}).map((field) => field.name);
		expect(names).toEqual(['kg', 'Later']);
		expect(ws.fields(id).map((field) => field.name)).toContain('mode');
	});

	it('types a blank table’s starting column from what fills it', () => {
		const { ws, apply } = setup();
		const blank = blankTable(ws);
		apply(blank.changes);
		const rows = parseCsv('name,kg\n80,1\n90,2');
		const columns = guessColumns(rows);
		apply(
			appendRows(ws, blank.id, rows, columns, guessTargets(columns, ws.fields(blank.id))).changes
		);

		const [name] = ws.fields(blank.id);
		expect(name.type).toBe('number');
		expect(ws.rows(blank.id)[0].data[name.id]).toBe(80);
	});
});

describe('a JSON export', () => {
	it('comes back whole on an empty device', () => {
		const { ws, tableId, exercise } = lifts();
		const records = parseExport(exportOf(ws));

		const target = setup();
		target.apply(restoreChanges(target.ws, records ?? []));

		expect(target.ws.tables(ws.table(tableId)?.base ?? '')[0].name).toBe('Lifts');
		expect(target.ws.rows(tableId).map((row) => row.data[exercise])).toEqual(
			ws.rows(tableId).map((row) => row.data[exercise])
		);
		expect(target.ws.views(tableId).map((view) => view.name)).toEqual(['Grid', 'Entry']);
	});

	it('brings back what was deleted and changed since, in one step', () => {
		const { ws, apply, tableId, exercise, ids } = lifts();
		const records = parseExport(exportOf(ws)) ?? [];
		apply(deleteRecords(ws, [ids[0]]));
		apply(updateRow(ws, ids[1], { [exercise]: 'Dips' }));
		const later = insertRows(ws, tableId, [{ [exercise]: 'Row' }]);
		apply(later.changes);

		const inverse = apply(restoreChanges(ws, records));
		expect(ws.live(ids[0])?.data[exercise]).toBe('Squat');
		expect(ws.live(ids[1])?.data[exercise]).toBe('Bench');
		expect(ws.live(later.ids[0])?.data[exercise]).toBe('Row');

		apply([...inverse].reverse());
		expect(ws.live(ids[0])).toBeUndefined();
		expect(ws.live(ids[1])?.data[exercise]).toBe('Dips');
	});

	it('changes nothing when this device already holds it', () => {
		const { ws } = lifts();

		expect(restoreChanges(ws, parseExport(exportOf(ws)) ?? [])).toEqual([]);
	});

	it('refuses what is not an export', () => {
		expect(parseExport('{"format":"other","records":[]}')).toBeNull();
		expect(parseExport('{"format":"torsel","records":[{"id":1}]}')).toBeNull();
		expect(parseExport('not json')).toBeNull();
	});
});
