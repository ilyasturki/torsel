import defaultNames from '#lib/i18n/names.ts';
import { describe, expect, it } from 'vitest';

import {
	addField,
	blankTable,
	createBase,
	createTable,
	defaultViews,
	deleteRecords,
	doneRows,
	entryFields,
	homeBase,
	insertRows,
	updateRecord
} from './actions.ts';
import { Hlc, formatClock } from './clock.ts';
import { guessColumns, importTable, parseCsv } from './csv.ts';
import { openEngine } from './engine.ts';
import {
	BARE_AGGREGATE,
	FormulaError,
	completeName,
	nameAt,
	namesFor,
	toDisplay,
	toStored
} from './formula.ts';
import { merge, sameRec } from './merge.ts';
import type { Change, FieldDef, Rec } from './model.ts';
import { isDeleted } from './model.ts';
import { pushBatch } from './protocol.ts';
import { formulaProblem, materializeBase, readQuery } from './sql.ts';
import { coerce, parseDate, parseNumber } from './values.ts';
import { Workspace } from './workspace.ts';

function apply(ws: Workspace, hlc: Hlc, changes: Change[]): Change[] {
	return changes.map((change) => ws.stamp(change, hlc.tick()).inverse);
}

function rec(id: string, data: Rec['data'], clocks: Rec['clocks']): Rec {
	return { id, kind: 'row', base: 'b_x', parent: 't_x', data, clocks };
}

describe('done rows', () => {
	const field = (id: string): FieldDef => ({ id, name: id, type: 'number' }) as FieldDef;
	const fields = [field('weight'), field('reps'), field('rpe')];
	const rows = [
		rec('r0', { weight: 55, reps: 6, rpe: null }, {}),
		rec('r1', { weight: 60, reps: 5, rpe: null }, {}),
		rec('r2', { weight: 62.5, reps: 5, rpe: 8 }, {}),
		rec('r3', { weight: 65, reps: '', rpe: null }, {}),
		rec('r4', { weight: null, reps: null, rpe: null }, {})
	];

	it('passes over a row that leaves blank a field most rows fill', () => {
		const done = doneRows(fields, rows);
		expect(rows.filter(done).map((row) => row.id)).toEqual(['r0', 'r1', 'r2']);
	});

	it('takes every row when no field is filled by most', () => {
		const done = doneRows(fields, [rows[4], rows[4]]);
		expect(done(rows[4])).toBe(true);
	});
});

describe('default entry view', () => {
	it('follows the fields added after the table was created', () => {
		const ws = new Workspace();
		const hlc = new Hlc('a');
		const base = createBase(ws, 'Gym');
		apply(ws, hlc, base.changes);
		const table = createTable(ws, base.id, 'Lifts', [{ name: 'Name', type: 'text' }], () =>
			defaultViews(defaultNames.en)
		);
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
		const table = createTable(
			ws,
			base.id,
			'Lifts',
			[
				{ name: 'Name', type: 'text' },
				{ name: 'Weight', type: 'number' }
			],
			() => defaultViews(defaultNames.en)
		);
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
		const table = createTable(
			ws,
			base.id,
			'Séries',
			[
				{ name: 'Poids', type: 'number' },
				{ name: 'Reps', type: 'number' }
			],
			() => defaultViews(defaultNames.en)
		);
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
		const table = createTable(ws, base.id, 'T', [], () => defaultViews(defaultNames.en));
		apply(ws, hlc, table.changes);
		apply(ws, hlc, deleteRecords(ws, [base.id]));

		expect(ws.bases()).toHaveLength(0);
		expect(ws.table(table.id)).toBeUndefined();
	});

	it('adds a field at a place among the others, last without one', () => {
		const ws = new Workspace();
		const hlc = new Hlc('a');
		const base = createBase(ws, 'B');
		apply(ws, hlc, base.changes);
		const table = createTable(
			ws,
			base.id,
			'T',
			[
				{ name: 'A', type: 'text' },
				{ name: 'B', type: 'text' }
			],
			() => defaultViews(defaultNames.en)
		);
		apply(ws, hlc, table.changes);
		const names = (): string[] => ws.fields(table.id).map((field) => field.name);

		apply(ws, hlc, addField(ws, table.id, { name: 'Between', type: 'text' }, 1).changes);
		expect(names()).toEqual(['A', 'Between', 'B']);
		apply(ws, hlc, addField(ws, table.id, { name: 'First', type: 'text' }, 0).changes);
		apply(ws, hlc, addField(ws, table.id, { name: 'Last', type: 'text' }).changes);
		expect(names()).toEqual(['First', 'A', 'Between', 'B', 'Last']);
	});

	it('moves a table revision only on its own rows and fields', () => {
		const ws = new Workspace();
		const hlc = new Hlc('a');
		const base = createBase(ws, 'B');
		apply(ws, hlc, base.changes);
		const weights = createTable(ws, base.id, 'Weights', [{ name: 'Kg', type: 'number' }], () =>
			defaultViews(defaultNames.en)
		);
		apply(ws, hlc, weights.changes);
		const sets = createTable(ws, base.id, 'Sets', [{ name: 'Reps', type: 'number' }], () =>
			defaultViews(defaultNames.en)
		);
		apply(ws, hlc, sets.changes);
		const before = { weights: ws.revision(weights.id), sets: ws.revision(sets.id) };

		apply(ws, hlc, insertRows(ws, weights.id, [{ [weights.fieldIds[0]]: 88 }]).changes);
		expect(ws.revision(weights.id)).toBeGreaterThan(before.weights);
		expect(ws.revision(sets.id)).toBe(before.sets);

		const after = ws.revision(weights.id);
		const [view] = ws.views(weights.id);
		apply(ws, hlc, updateRecord(ws, view.id, { config: { widths: { a: 200 } } }));
		apply(ws, hlc, updateRecord(ws, weights.id, { name: 'Weigh-ins' }));
		expect(ws.revision(weights.id)).toBe(after);

		apply(ws, hlc, addField(ws, sets.id, { name: 'Kg', type: 'number' }).changes);
		expect(ws.revision(sets.id)).toBeGreaterThan(before.sets);
		expect(ws.revision(weights.id)).toBe(after);
	});
});

describe('home base', () => {
	it('is made once, by the first table, and two devices land on the same one', () => {
		const phone = new Workspace();
		const desk = new Workspace();
		const home = homeBase(phone, defaultNames.en);

		expect(home.changes).toHaveLength(1);
		expect(homeBase(desk, defaultNames.en).id).toBe(home.id);

		const hlc = new Hlc('a');
		apply(phone, hlc, home.changes);
		expect(homeBase(phone, defaultNames.en)).toEqual({ id: home.id, changes: [] });
	});

	it('reuses a base that already exists', () => {
		const ws = new Workspace();
		const made = createBase(ws, 'Gym');
		apply(ws, new Hlc('a'), made.changes);

		expect(homeBase(ws, defaultNames.en)).toEqual({ id: made.id, changes: [] });
	});

	it('names a blank table with the first free number', () => {
		const ws = new Workspace();
		const hlc = new Hlc('a');

		const first = blankTable(ws, defaultNames.en);
		apply(ws, hlc, first.changes);
		const second = blankTable(ws, defaultNames.en);
		apply(ws, hlc, second.changes);

		expect([first.name, second.name]).toEqual(['Table 1', 'Table 2']);
		expect(ws.bases()).toHaveLength(1);
		expect(ws.fields(first.id).map((field) => field.name)).toEqual(['Name']);
	});

	it('leaves the tables of a deleted home deleted', () => {
		const ws = new Workspace();
		const hlc = new Hlc('a');
		const home = homeBase(ws, defaultNames.en);
		apply(ws, hlc, home.changes);
		const table = createTable(ws, home.id, 'Weight', [{ name: 'Kg', type: 'number' }], () =>
			defaultViews(defaultNames.en)
		);
		apply(ws, hlc, table.changes);
		apply(ws, hlc, deleteRecords(ws, [home.id]));

		const next = homeBase(ws, defaultNames.en);
		apply(ws, hlc, next.changes);

		expect(next.id).not.toBe(home.id);
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

	it('finds the name being typed, quoted or bare, but not inside text or a comment', () => {
		expect(nameAt('"Kg" * re', 9)).toEqual({ from: 7, query: 're', quoted: false });
		expect(nameAt('"Kg" * "Date wa', 15)).toEqual({ from: 7, query: 'Date wa', quoted: true });
		expect(nameAt('"Kg" * ', 7)).toBeNull();
		expect(nameAt("'re", 3)).toBeNull();
		expect(nameAt('1 -- re', 7)).toBeNull();
		expect(nameAt('x2', 2)).toEqual({ from: 0, query: 'x2', quoted: false });
		expect(nameAt('2x', 2)).toBeNull();
	});

	it('offers the names that start with it first, and none for a bare word already a name', () => {
		const names = ['Reps', 'Rest', 'Pre-reps', 'Kg'];
		expect(namesFor({ from: 0, query: 're', quoted: false }, names)).toEqual([
			'Reps',
			'Rest',
			'Pre-reps'
		]);
		expect(namesFor({ from: 0, query: 'reps', quoted: false }, names)).toEqual([]);
		expect(namesFor({ from: 0, query: 'reps', quoted: true }, names)).toEqual(['Reps', 'Pre-reps']);
		expect(namesFor({ from: 0, query: '', quoted: true }, names)).toEqual(names);
	});

	it('writes the picked name quoted in place of what was typed', () => {
		const at = { from: 7, query: 're', quoted: false };
		expect(completeName('"Kg" * re + 1', 9, at, 'Reps')).toEqual({
			text: '"Kg" * "Reps" + 1',
			caret: 13
		});
		const open = { from: 0, query: 'Da', quoted: true };
		expect(completeName('"Da" + 1', 3, open, 'Day "1"')).toEqual({
			text: '"Day ""1""" + 1',
			caret: 11
		});
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
		const table = createTable(
			ws,
			base.id,
			'Séries',
			[
				{ name: 'Exercice', type: 'choice' },
				{ name: 'Poids', type: 'number' },
				{ name: 'Reps', type: 'number' }
			],
			() => defaultViews(defaultNames.en)
		);
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

		const { rows } = readQuery(
			engine,
			'select "Exercice", "1RM estimé" from "Séries" order by "Exercice"'
		);
		expect(rows).toEqual([
			['bench press', 96],
			['dips', null]
		]);

		expect(() => readQuery(engine, `delete from ${table.id}`)).toThrow();
		expect(formulaProblem(engine, ws, table.id, 'nope(1)')).toMatch(/no such function/u);
		const bare = (text: string): string | null =>
			formulaProblem(engine, ws, table.id, toStored(text, ws.fields(table.id)));
		expect(bare('SUM("Poids")')).toBe(BARE_AGGREGATE);
		expect(bare('max("Reps")')).toBe(BARE_AGGREGATE);
		expect(bare('count(*) + 1')).toBe(BARE_AGGREGATE);
		expect(bare('SUM("Poids") OVER ()')).toBeNull();
		expect(bare('max("Poids", "Reps")')).toBeNull();
		expect(bare('"Poids" * 2')).toBeNull();
		expect(bare('AVERAGE("Poids")')).toBe(BARE_AGGREGATE);
		expect(bare('COUNTIF("Exercice", \'dips\')')).toBe(BARE_AGGREGATE);
		expect(bare('AVERAGE("Poids") OVER ()')).toBeNull();
		expect(bare('AVERAGE("Poids", "Reps")')).toBeNull();
		engine.close();
	});

	it('computes the Sheets functions inside the table', async () => {
		const ws = new Workspace();
		const hlc = new Hlc('a');
		const base = createBase(ws, 'Muscu');
		apply(ws, hlc, base.changes);
		const table = createTable(
			ws,
			base.id,
			'Séries',
			[
				{ name: 'Exercice', type: 'text' },
				{ name: 'Date', type: 'date' }
			],
			() => defaultViews(defaultNames.en)
		);
		apply(ws, hlc, table.changes);
		const [exercice, date] = table.fieldIds;
		apply(
			ws,
			hlc,
			addField(ws, table.id, {
				name: 'Code',
				type: 'formula',
				expr: toStored(
					'UPPER(LEFT("Exercice", 3)) || MONTH("Date") || \'/\' || COUNTIF("Exercice", \'b*\') OVER ()',
					ws.fields(table.id)
				)
			}).changes
		);
		apply(
			ws,
			hlc,
			insertRows(ws, table.id, [
				{ [exercice]: 'bench press', [date]: '2026-11-16' },
				{ [exercice]: 'dips', [date]: '2026-10-02' }
			]).changes
		);

		const engine = await openEngine();
		expect(materializeBase(engine, ws, base.id, true).get(table.id)?.size).toBe(0);
		expect(readQuery(engine, 'select "Code" from "Séries" order by 1').rows).toEqual([
			['BEN11/1'],
			['DIP10/1']
		]);
		engine.close();
	});

	it('leaves a bare aggregate out of the table so every other formula keeps its rows', async () => {
		const ws = new Workspace();
		const hlc = new Hlc('a');
		const base = createBase(ws, 'Muscu');
		apply(ws, hlc, base.changes);
		const table = createTable(ws, base.id, 'Séries', [{ name: 'Poids', type: 'number' }], () =>
			defaultViews(defaultNames.en)
		);
		apply(ws, hlc, table.changes);
		for (const [name, text] of [
			['Total', 'SUM("Poids")'],
			['Double', '"Poids" * 2']
		]) {
			apply(
				ws,
				hlc,
				addField(ws, table.id, {
					name,
					type: 'formula',
					expr: toStored(text, ws.fields(table.id))
				}).changes
			);
		}
		const [poids] = table.fieldIds;
		apply(ws, hlc, insertRows(ws, table.id, [{ [poids]: 10 }, { [poids]: 20 }]).changes);
		const [total, double] = ws.fields(table.id).slice(1);

		const engine = await openEngine();
		const problems = materializeBase(engine, ws, base.id, true);
		expect(problems.get(table.id)?.get(total.id)).toBe(BARE_AGGREGATE);
		const rows = engine.all(`select ${double.id} as d, ${total.id} as t from v_${table.id}`);
		expect(rows).toEqual([
			{ d: 20, t: null },
			{ d: 40, t: null }
		]);
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
		const types = guessColumns(parseCsv(sheet), defaultNames.en).map((column) => column.type);
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
		const columns = guessColumns(rows, defaultNames.en);

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

		const { id, changes } = importTable(ws, defaultNames.en, base.id, 'Séries', parseCsv(sheet));
		apply(ws, hlc, changes);

		const fields = ws.fields(id);
		const weight = fields.find((field) => field.name === 'weight');
		const rows = ws.rows(id);
		expect(rows).toHaveLength(3);
		expect(rows[2].data[weight?.id ?? '']).toBe(17.5);
	});
});

describe('sync push', () => {
	const rec = (id: string, text: string): Rec => ({
		id,
		kind: 'row',
		base: 'b',
		parent: 't',
		data: { text },
		clocks: { text: formatClock(1, 0, 'n') }
	});

	it('cuts a batch under the server body limit, by bytes', () => {
		const dirty = Array.from({ length: 1000 }, (_, i) => rec(`r${i}`, 'é'.repeat(500)));
		const batch = pushBatch(dirty);
		expect(batch.length).toBeGreaterThan(0);
		expect(batch.length).toBeLessThan(1000);
		expect(
			new TextEncoder().encode(JSON.stringify({ watermark: 0, push: batch })).length
		).toBeLessThan(512 * 1024);
	});

	it('still sends one record bigger than the limit', () => {
		expect(pushBatch([rec('big', 'x'.repeat(600_000)), rec('next', '')])).toHaveLength(1);
	});
});
