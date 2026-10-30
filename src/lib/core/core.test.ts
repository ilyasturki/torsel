import { describe, expect, it } from 'vitest';

import {
	addField,
	createBase,
	createTable,
	deleteRecords,
	entryFields,
	insertRows,
	updateRecord
} from './actions.ts';
import { Hlc, formatClock } from './clock.ts';
import { guessColumns, importTable, parseCsv } from './csv.ts';
import { openEngine } from './engine.ts';
import { FormulaError, toDisplay, toStored } from './formula.ts';
import { merge, sameRec } from './merge.ts';
import type { Change, Rec } from './model.ts';
import { isDeleted } from './model.ts';
import { formulaProblem, materializeBase, readQuery } from './sql.ts';
import { coerce, parseDate, parseNumber } from './values.ts';
import { Workspace } from './workspace.ts';

function apply(ws: Workspace, hlc: Hlc, changes: Change[]): Change[] {
	return changes.map((change) => ws.stamp(change, hlc.tick()).inverse);
}

function rec(id: string, data: Rec['data'], clocks: Rec['clocks']): Rec {
	return { id, kind: 'row', base: 'b_x', parent: 't_x', data, clocks };
}

describe('default entry view', () => {
	it('follows the fields added after the table was created', () => {
		const ws = new Workspace();
		const hlc = new Hlc('a');
		const base = createBase(ws, 'Gym');
		apply(ws, hlc, base.changes);
		const table = createTable(ws, base.id, 'Lifts', [{ name: 'Name', type: 'text' }]);
		apply(ws, hlc, table.changes);

		const later = addField(ws, table.id, { name: 'Weight', type: 'number' });
		apply(ws, hlc, later.changes);
		const formula = addField(ws, table.id, { name: 'Double', type: 'formula', expr: '1' });
		apply(ws, hlc, formula.changes);

		const entry = ws.views(table.id).find((view) => view.type === 'entry');
		const names = entryFields(ws.fields(table.id), entry?.config ?? {}).map((field) => field.name);

		expect(names).toEqual(['Name', 'Weight']);
	});

	it('keeps the list a view chose for itself', () => {
		const ws = new Workspace();
		const hlc = new Hlc('a');
		const base = createBase(ws, 'Gym');
		apply(ws, hlc, base.changes);
		const table = createTable(ws, base.id, 'Lifts', [
			{ name: 'Name', type: 'text' },
			{ name: 'Weight', type: 'number' }
		]);
		apply(ws, hlc, table.changes);

		const chosen = entryFields(ws.fields(table.id), { fields: [table.fieldIds[1]] });

		expect(chosen.map((field) => field.name)).toEqual(['Weight']);
	});
});

describe('clocks', () => {
	it('orders as strings the way they happened', () => {
		let time = 1000;
		const hlc = new Hlc('a', () => time);
		const first = hlc.tick();
		const second = hlc.tick();
		time = 900;
		const third = hlc.tick();

		expect(first < second && second < third).toBe(true);
	});

	it('steps past a remote clock it has seen, whatever its own wall says', () => {
		const behind = new Hlc('a', () => 1000);
		behind.observe(formatClock(5000, 3, 'b'));

		expect(behind.tick() > formatClock(5000, 3, 'b')).toBe(true);
	});
});

describe('merge', () => {
	const a = rec('r_1', { x: 1, y: 'a' }, { x: formatClock(1, 0, 'a'), y: formatClock(5, 0, 'a') });
	const b = rec('r_1', { x: 2, y: 'b' }, { x: formatClock(3, 0, 'b'), y: formatClock(2, 0, 'b') });

	it('keeps the newer value of each key', () => {
		expect(merge(a, b).data).toEqual({ x: 2, y: 'a' });
	});

	it('settles the same whichever side merges', () => {
		expect(sameRec(merge(a, b), merge(b, a))).toBe(true);
		expect(sameRec(merge(merge(a, b), b), merge(a, b))).toBe(true);
	});
});

describe('workspace', () => {
	it('undoes a change by stamping its inverse', () => {
		const ws = new Workspace();
		const hlc = new Hlc('a');
		const base = createBase(ws, 'Muscu');
		apply(ws, hlc, base.changes);
		const table = createTable(ws, base.id, 'Séries', [
			{ name: 'Poids', type: 'number' },
			{ name: 'Reps', type: 'number' }
		]);
		apply(ws, hlc, table.changes);

		const [poids] = table.fieldIds;
		const rows = insertRows(ws, table.id, [{ [poids]: '82,5' }]);
		const created = apply(ws, hlc, rows.changes);
		expect(ws.rows(table.id)[0].data[poids]).toBe(82.5);

		const edit = apply(ws, hlc, updateRecord(ws, rows.ids[0], { [poids]: 85 }));
		apply(ws, hlc, edit);
		expect(ws.rows(table.id)[0].data[poids]).toBe(82.5);

		apply(ws, hlc, created);
		expect(ws.rows(table.id)).toHaveLength(0);
		expect(isDeleted(ws.get(rows.ids[0]) as Rec)).toBe(true);
	});

	it('hides the tables of a deleted base', () => {
		const ws = new Workspace();
		const hlc = new Hlc('a');
		const base = createBase(ws, 'B');
		apply(ws, hlc, base.changes);
		const table = createTable(ws, base.id, 'T', []);
		apply(ws, hlc, table.changes);
		apply(ws, hlc, deleteRecords(ws, [base.id]));

		expect(ws.bases()).toHaveLength(0);
		expect(ws.table(table.id)).toBeUndefined();
	});
});

describe('formulas', () => {
	const fields = [
		{ id: 'f_poids', name: 'Poids' },
		{ id: 'f_reps', name: 'Reps' }
	];

	it('stores names as ids and reads them back under the current names', () => {
		const stored = toStored('CASE WHEN "Poids" > 0 THEN poids * (1 + Reps / 30.0) END', fields);

		expect(stored).toBe('CASE WHEN {{f_poids}} > 0 THEN {{f_poids}} * (1 + {{f_reps}} / 30.0) END');

		const renamed = [{ id: 'f_poids', name: 'Charge' }, fields[1]];
		expect(toDisplay(stored, renamed)).toBe(
			'CASE WHEN "Charge" > 0 THEN "Charge" * (1 + "Reps" / 30.0) END'
		);
	});

	it('leaves functions and string literals alone', () => {
		expect(toStored("max(reps, 1) || 'Poids'", fields)).toBe("max({{f_reps}}, 1) || 'Poids'");
	});

	it('refuses an unknown field and a second statement', () => {
		expect(() => toStored('"Tonnage" * 2', fields)).toThrow(FormulaError);
		expect(() => toStored('1; drop table x', fields)).toThrow(FormulaError);
	});
});

describe('values', () => {
	it('reads the formats a sheet and an export write', () => {
		expect(parseNumber('9,5')).toBe(9.5);
		expect(parseNumber('1 234,5')).toBe(1234.5);
		expect(parseNumber('12a')).toBeNull();
		expect(parseDate('28/12/2025')).toBe('2025-12-28');
		expect(parseDate('2026-08-02')).toBe('2026-08-02');
		expect(parseDate('31/02/2026')).toBeNull();
		expect(coerce({ type: 'check' }, 'true')).toBe(true);
	});
});

describe('materialize', () => {
	it('computes formulas in SQL and names views as the person reads them', async () => {
		const ws = new Workspace();
		const hlc = new Hlc('a');
		const base = createBase(ws, 'Muscu');
		apply(ws, hlc, base.changes);
		const table = createTable(ws, base.id, 'Séries', [
			{ name: 'Exercice', type: 'choice' },
			{ name: 'Poids', type: 'number' },
			{ name: 'Reps', type: 'number' }
		]);
		apply(ws, hlc, table.changes);
		const [exercice, poids, reps] = table.fieldIds;

		const stored = toStored(
			'CASE WHEN "Poids" > 0 THEN ROUND("Poids" * (1 + "Reps" / 30.0), 1) END',
			ws.fields(table.id)
		);
		apply(
			ws,
			hlc,
			addField(ws, table.id, { name: '1RM estimé', type: 'formula', expr: stored }).changes
		);
		apply(
			ws,
			hlc,
			insertRows(ws, table.id, [
				{ [exercice]: 'bench press', [poids]: 80, [reps]: 6 },
				{ [exercice]: 'dips', [poids]: 0, [reps]: 7 }
			]).changes
		);

		const engine = await openEngine();
		const problems = materializeBase(engine, ws, base.id, true);
		expect(problems.get(table.id)?.size).toBe(0);
		engine.readOnly();

		const rows = readQuery(
			engine,
			'select "Exercice", "1RM estimé" from "Séries" order by "Exercice"'
		);
		expect(rows).toEqual([
			{ Exercice: 'bench press', '1RM estimé': 96 },
			{ Exercice: 'dips', '1RM estimé': null }
		]);

		expect(() => readQuery(engine, `delete from ${table.id}`)).toThrow();
		expect(formulaProblem(engine, ws, table.id, 'nope(1)')).toMatch(/no such function/u);
		engine.close();
	});
});

describe('csv', () => {
	const sheet = [
		'session,date,n,exercise,muscle,reps,weight,rpe',
		'push a,28/12/2025,1,bench press dumbbell,chest,5,36,',
		'push a,28/12/2025,2,bench press dumbbell,chest,9,32,"9,5"',
		'pull a,29/12/2025,1,rowing barbell,back,7,"17,5",10'
	].join('\n');

	const kilorep = [
		'date,workout,exercise,set,type,weight_kg,load_mode,reps,rpe,grip,arms,completed,load_kg,note',
		'2026-08-02,Push A,Bench Press,1,normal,80,total,6,,,both,true,,',
		'2026-08-02,Push A,Bench Press,2,normal,82.5,total,5,8.5,,both,false,,"seat 5, low"'
	].join('\r\n');

	it('infers the Google Sheet export', () => {
		const types = guessColumns(parseCsv(sheet)).map((column) => column.type);
		expect(types).toEqual([
			'choice',
			'date',
			'number',
			'choice',
			'choice',
			'number',
			'number',
			'number'
		]);
	});

	it('infers the kilorep export and keeps quoted commas', () => {
		const rows = parseCsv(kilorep);
		const columns = guessColumns(rows);

		expect(rows[2][13]).toBe('seat 5, low');
		expect(columns.find((column) => column.name === 'date')?.type).toBe('date');
		expect(columns.find((column) => column.name === 'weight_kg')?.type).toBe('number');
		expect(columns.find((column) => column.name === 'completed')?.type).toBe('check');
	});

	it('imports rows with their values coerced', () => {
		const ws = new Workspace();
		const hlc = new Hlc('a');
		const base = createBase(ws, 'Muscu');
		apply(ws, hlc, base.changes);

		const { id, changes } = importTable(ws, base.id, 'Séries', parseCsv(sheet));
		apply(ws, hlc, changes);

		const fields = ws.fields(id);
		const weight = fields.find((field) => field.name === 'weight');
		const rows = ws.rows(id);
		expect(rows).toHaveLength(3);
		expect(rows[2].data[weight?.id ?? '']).toBe(17.5);
	});
});
