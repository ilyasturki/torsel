import defaultNames from '#lib/i18n/names.ts';
import { afterAll, describe, expect, it } from 'vitest';

import { SqlPool } from '../server/sql/pool.ts';
import {
	addField,
	createBase,
	createTable,
	defaultViews,
	insertRows,
	updateRecord
} from './actions.ts';
import { Hlc } from './clock.ts';
import { openEngine } from './engine.ts';
import {
	FormulaError,
	callAt,
	completeFunction,
	functionsFor,
	nameAt,
	namesIn,
	scopeOf,
	toDisplay,
	toStored
} from './formula.ts';
import type { Change } from './model.ts';
import { formulaProblem, formulaTables, materializeTable } from './sql.ts';
import { Workspace } from './workspace.ts';

function gym() {
	const ws = new Workspace();
	const hlc = new Hlc('a');
	const apply = ({ changes }: { changes: Change[] }): void => {
		for (const change of changes) ws.stamp(change, hlc.tick());
	};
	const base = createBase(ws, 'Gym');
	apply(base);
	const exercises = createTable(
		ws,
		base.id,
		'Exercises',
		[
			{ name: 'Name', type: 'text' },
			{ name: 'Muscle', type: 'text' }
		],
		() => defaultViews(defaultNames.en)
	);
	apply(exercises);
	const sets = createTable(
		ws,
		base.id,
		'Sets',
		[
			{ name: 'Weight', type: 'number' },
			{ name: 'Reps', type: 'number' }
		],
		() => defaultViews(defaultNames.en)
	);
	apply(sets);
	const link = addField(ws, sets.id, { name: 'Exercise', type: 'link', target: exercises.id });
	apply(link);

	const [name, muscle] = exercises.fieldIds;
	const [weight, reps] = sets.fieldIds;
	const rows = insertRows(ws, exercises.id, [
		{ [name]: 'Bench', [muscle]: 'chest' },
		{ [name]: 'Squat', [muscle]: 'legs' },
		{ [name]: 'Plank', [muscle]: 'core' }
	]);
	apply(rows);
	const [bench, squat] = rows.ids;
	apply(
		insertRows(ws, sets.id, [
			{ [link.id]: bench, [weight]: 80, [reps]: 5 },
			{ [link.id]: bench, [weight]: 85, [reps]: 3 },
			{ [link.id]: squat, [weight]: 100, [reps]: 5 },
			{ [weight]: 20, [reps]: 10 }
		])
	);

	const formula = (tableId: string, label: string, text: string): string => {
		const made = addField(ws, tableId, {
			name: label,
			type: 'formula',
			expr: toStored(text, scopeOf(ws, tableId))
		});
		apply(made);
		return made.id;
	};

	return { ws, apply, base: base.id, exercises, sets, link: link.id, formula, bench, muscle };
}

async function values(
	ws: Workspace,
	tableId: string,
	fieldId: string,
	order: string
): Promise<unknown[]> {
	const engine = await openEngine();
	try {
		const problems = materializeTable(engine, ws, tableId);
		expect([...problems]).toEqual([]);
		return engine
			.all(`select ${fieldId} as v from v_${tableId} t order by ${order}`)
			.map((row) => row.v);
	} finally {
		engine.close();
	}
}

describe('names through links', () => {
	it('stores a lookup and a rollup as ids and shows them under the current names', () => {
		const { ws, base, exercises, sets, link, muscle } = gym();
		const lookup = toStored('UPPER("Exercise".muscle)', scopeOf(ws, sets.id));
		expect(lookup).toBe(`UPPER({{${link}}}.{{${muscle}}})`);
		const [weight, reps] = sets.fieldIds;
		const rollup = toStored(
			'SUM("Sets"."Weight" * Sets.Reps) + COUNT("Sets")',
			scopeOf(ws, exercises.id)
		);
		expect(rollup).toBe(
			`SUM({{${sets.id}}}.{{${weight}}} * {{${sets.id}}}.{{${reps}}}) + COUNT({{${sets.id}}})`
		);
		expect(toDisplay(rollup, namesIn(ws, base))).toBe(
			'SUM("Sets"."Weight" * "Sets"."Reps") + COUNT("Sets")'
		);
		expect(toDisplay(`{{${link}}}.{{f_gone}}`, namesIn(ws, base))).toBe('NULL');
	});

	it('refuses what a dot cannot reach, and a linking table outside an aggregate', () => {
		const { ws, exercises, sets } = gym();
		const problem = (tableId: string, text: string): string => {
			try {
				toStored(text, scopeOf(ws, tableId));
			} catch (error) {
				return error instanceof FormulaError ? `${error.problem} ${error.subject}` : 'other';
			}
			return 'none';
		};
		expect(problem(sets.id, '"Weight"."Name"')).toBe('not-a-link Weight');
		expect(problem(sets.id, '"Exercise"."Weight"')).toBe('unknown-field Weight');
		expect(problem(exercises.id, '"Sets"."Weight" * 2')).toBe('needs-aggregate Sets');
		expect(problem(exercises.id, 'ROUND("Sets"."Weight")')).toBe('needs-aggregate Sets');
		expect(problem(exercises.id, 'ROUND(AVERAGE("Sets"."Weight"), 1)')).toBe('none');
		expect(problem(exercises.id, 'MAX("Sets"."Weight", 0)')).toBe('needs-aggregate Sets');
		expect(problem(exercises.id, 'MIN("Sets"."Weight", "Sets"."Reps")')).toBe(
			'needs-aggregate Sets'
		);
		expect(problem(exercises.id, 'AVERAGE("Sets"."Weight", 1)')).toBe('needs-aggregate Sets');
		expect(problem(exercises.id, 'MAX(MAX("Sets"."Weight"), 0)')).toBe('none');
		expect(problem(exercises.id, 'COUNTIF("Sets"."Weight", \'>1\')')).toBe('none');
		expect(problem(exercises.id, 'GROUP_CONCAT("Sets"."Weight", \', \')')).toBe('none');
		expect(problem(sets.id, 'SUM("Exercises"."Name")')).toBe('unknown-field Exercises');
	});

	it('refuses a rollup over a table that links here twice, naming both links', () => {
		const { ws, apply, exercises, sets } = gym();
		apply(addField(ws, sets.id, { name: 'Superset with', type: 'link', target: exercises.id }));
		try {
			toStored('SUM("Sets"."Weight")', scopeOf(ws, exercises.id));
			expect.unreachable();
		} catch (error) {
			expect(error).toMatchObject({
				problem: 'two-links',
				subject: 'Sets',
				others: ['Exercise', 'Superset with']
			});
		}
	});

	it('reads its own field first, and refuses a dotted name that reads two ways', () => {
		const { ws, apply, exercises, sets } = gym();
		const count = addField(ws, exercises.id, { name: 'Sets', type: 'number' });
		apply(count);
		expect(toStored('"Sets" + 1', scopeOf(ws, exercises.id))).toBe(`{{${count.id}}} + 1`);
		expect(toStored('SUM("Sets"."Weight")', scopeOf(ws, exercises.id))).toContain(sets.id);

		apply({ changes: updateRecord(ws, count.id, { type: 'link', target: sets.id }) });
		expect(() => toStored('MAX("Sets"."Weight")', scopeOf(ws, exercises.id))).toThrow(
			expect.objectContaining({ problem: 'two-readings', subject: 'Sets' })
		);
	});
});

describe('lookups and rollups in SQL', () => {
	it('reads a field of the linked row, a formula there included', async () => {
		const { ws, sets, formula, exercises } = gym();
		formula(exercises.id, 'Label', 'UPPER(LEFT("Name", 3))');
		const muscle = formula(sets.id, 'Muscle', '"Exercise"."Muscle"');
		const label = formula(sets.id, 'Label', 'CONCATENATE("Exercise"."Label", \' \', "Weight")');

		expect(await values(ws, sets.id, muscle, '"_at", id')).toEqual([
			'chest',
			'chest',
			'legs',
			null
		]);
		expect(await values(ws, sets.id, label, '"_at", id')).toEqual([
			'BEN 80',
			'BEN 85',
			'SQU 100',
			' 20'
		]);
		expect(formulaTables(ws, sets.id)).toEqual(new Set([exercises.id]));
	});

	it('folds the rows linking here, with an expression and Sheets aggregates', async () => {
		const { ws, formula, exercises } = gym();
		const volume = formula(exercises.id, 'Volume', 'SUM("Sets"."Weight" * "Sets"."Reps")');
		const count = formula(exercises.id, 'Count', 'COUNT("Sets")');
		const average = formula(exercises.id, 'Average', 'AVERAGE("Sets"."Weight")');
		const heavy = formula(exercises.id, 'Heavy', 'COUNTIF("Sets"."Weight", \'>=85\')');

		expect(await values(ws, exercises.id, volume, '"_at", id')).toEqual([655, 500, null]);
		expect(await values(ws, exercises.id, count, '"_at", id')).toEqual([2, 1, 0]);
		expect(await values(ws, exercises.id, average, '"_at", id')).toEqual([82.5, 100, null]);
		expect(await values(ws, exercises.id, heavy, '"_at", id')).toEqual([1, 1, 0]);
	});

	it('reads a lookup of its own row inside a rollup', async () => {
		const { ws, apply, base, sets, formula, exercises, bench } = gym();
		const categories = createTable(
			ws,
			base,
			'Categories',
			[{ name: 'Factor', type: 'number' }],
			() => defaultViews(defaultNames.en)
		);
		apply(categories);
		const made = insertRows(ws, categories.id, [{ [categories.fieldIds[0]]: 2 }]);
		apply(made);
		const category = addField(ws, exercises.id, {
			name: 'Category',
			type: 'link',
			target: categories.id
		});
		apply(category);
		apply({ changes: updateRecord(ws, bench, { [category.id]: made.ids[0] }) });
		const scaled = formula(exercises.id, 'Scaled', 'SUM("Sets"."Weight" * "Category"."Factor")');

		expect(await values(ws, exercises.id, scaled, '"_at", id')).toEqual([330, null, null]);
		expect(formulaTables(ws, exercises.id)).toEqual(new Set([sets.id, categories.id]));
	});

	it('rolls up a lookup and follows a rename of every name involved', async () => {
		const { ws, apply, base, sets, formula, exercises, link } = gym();
		const kg = formula(sets.id, 'Kg', '"Weight"');
		const best = formula(exercises.id, 'Best', 'MAX("Sets"."Kg")');
		apply({ changes: updateRecord(ws, kg, { name: 'Load' }) });
		apply({ changes: updateRecord(ws, link, { name: 'Movement' }) });
		apply({ changes: updateRecord(ws, sets.id, { name: 'Lifts' }) });

		expect(await values(ws, exercises.id, best, '"_at", id')).toEqual([85, 100, null]);
		expect(toDisplay(ws.field(best)?.expr ?? '', namesIn(ws, base))).toBe('MAX("Lifts"."Load")');
	});

	it('rebuilds a lookup once the linked table changes on the same engine', async () => {
		const { ws, apply, sets, formula, bench, muscle, link } = gym();
		const looked = formula(sets.id, 'Muscle', '"Exercise"."Muscle"');
		const engine = await openEngine();
		materializeTable(engine, ws, sets.id);
		const read = (): unknown =>
			engine.all(`select ${looked} as v from v_${sets.id} where ${link} = '${bench}'`)[0].v;
		expect(read()).toBe('chest');

		apply({ changes: updateRecord(ws, bench, { [muscle]: 'pecs' }) });
		materializeTable(engine, ws, sets.id);
		expect(read()).toBe('pecs');
		engine.close();
	});

	it('gives a loop across tables no value instead of failing the table', async () => {
		const { ws, apply, sets, formula, exercises } = gym();
		const there = formula(exercises.id, 'There', '1');
		const here = formula(sets.id, 'Here', '"Exercise"."There"');
		apply({
			changes: updateRecord(ws, there, {
				expr: toStored('MAX("Sets"."Here")', scopeOf(ws, exercises.id))
			})
		});
		const engine = await openEngine();
		materializeTable(engine, ws, sets.id);
		expect(engine.all(`select ${here} as v from v_${sets.id}`).map((row) => row.v)).toEqual([
			null,
			null,
			null,
			null
		]);
		engine.close();
	});

	it('checks a new lookup against a table not built yet', async () => {
		const { ws, sets, link, muscle } = gym();
		const engine = await openEngine();
		expect(formulaProblem(engine, ws, sets.id, `{{${link}}}.{{${muscle}}}`)).toBeNull();
		engine.close();
	});
});

describe('lookups on the server', () => {
	const pool = new SqlPool(1);
	afterAll(() => pool.close());

	it('answers a query over a lookup and a rollup', async () => {
		const { ws, base, sets, formula, exercises } = gym();
		formula(sets.id, 'Muscle', '"Exercise"."Muscle"');
		formula(exercises.id, 'Volume', 'SUM("Sets"."Weight" * "Sets"."Reps")');
		const records = [...ws.records.values()];

		const muscles = await pool.run(records, base, {
			kind: 'query',
			sql: 'select "Muscle", count(*) from "Sets" group by 1 order by 1',
			offset: 0
		});
		expect(muscles.rows).toEqual([
			[null, 1],
			['chest', 2],
			['legs', 1]
		]);
		const volume = await pool.run(records, base, {
			kind: 'query',
			sql: 'select "Name", "Volume" from "Exercises" order by 1',
			offset: 0
		});
		expect(volume.rows).toEqual([
			['Bench', 655],
			['Plank', null],
			['Squat', 500]
		]);
	});
});

describe('formula completion', () => {
	it('names the link or table before a dot', () => {
		expect(nameAt('"Exercise".', 11)).toEqual({
			from: 11,
			query: '',
			quoted: false,
			owner: 'Exercise'
		});
		expect(nameAt('"Exercise"."Mu', 14)).toEqual({
			from: 11,
			query: 'Mu',
			quoted: true,
			owner: 'Exercise'
		});
		expect(nameAt('SUM(Sets.we', 11)).toEqual({
			from: 9,
			query: 'we',
			quoted: false,
			owner: 'Sets'
		});
		expect(nameAt('1.', 2)).toBeNull();
	});

	it('offers functions for a bare word and writes the call open', () => {
		expect(functionsFor({ from: 0, query: 'le', quoted: false })).toEqual(['LEN', 'LEFT']);
		expect(functionsFor({ from: 0, query: 'su', quoted: false })).toEqual([
			'SUM',
			'SUMIF',
			'SUBSTITUTE'
		]);
		expect(functionsFor({ from: 0, query: 'le', quoted: true })).toEqual([]);
		const at = { from: 4, query: 'le', quoted: false };
		expect(completeFunction('1 + le', 6, at, 'LEFT')).toEqual({ text: '1 + LEFT(', caret: 9 });
		expect(completeFunction('1 + le("a")', 6, at, 'LEFT')).toEqual({
			text: '1 + LEFT("a")',
			caret: 9
		});
	});

	it('finds the call around the caret and its argument', () => {
		expect(callAt('LEFT("Name", ', 13)).toEqual({ name: 'LEFT', arg: 1 });
		expect(callAt('ROUND((1 + ', 11)).toEqual({ name: 'ROUND', arg: 0 });
		expect(callAt("IF('a,b', ", 10)).toEqual({ name: 'IF', arg: 1 });
		expect(callAt('LEFT("x")', 9)).toBeNull();
	});
});
