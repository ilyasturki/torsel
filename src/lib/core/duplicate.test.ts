import names from '#lib/i18n/names.ts';
import { describe, expect, it } from 'vitest';

import { PATH, SOURCE, canAddRows, canEditValues } from './access.ts';
import {
	addField,
	createBase,
	createTable,
	defaultViews,
	insertRows,
	updateRecord
} from './actions.ts';
import { Hlc } from './clock.ts';
import { duplicateField, duplicateRows, duplicateTable, duplicateView } from './duplicate.ts';
import { toDisplay, toStored } from './formula.ts';
import type { Change } from './model.ts';
import { CREATED } from './model.ts';
import { Workspace } from './workspace.ts';

function fixture() {
	const ws = new Workspace();
	const hlc = new Hlc('test');
	const commit = (changes: Change[]): void => {
		for (const change of changes) ws.stamp(change, hlc.tick());
	};
	const base = createBase(ws, 'Gym');
	commit(base.changes);
	const table = createTable(
		ws,
		base.id,
		'Sets',
		[
			{ name: 'Exercise', type: 'text' },
			{ name: 'Kg', type: 'number' }
		],
		() => defaultViews(names.en)
	);
	commit(table.changes);
	const [exercise, kg] = table.fieldIds;
	commit(addField(ws, table.id, { name: 'Next', type: 'link', target: table.id }).changes);
	commit(
		addField(ws, table.id, {
			name: 'Double',
			type: 'formula',
			expr: toStored('"Kg" * 2', ws.fields(table.id))
		}).changes
	);
	commit(
		insertRows(
			ws,
			table.id,
			[
				{ [exercise]: 'Squat', [kg]: 100 },
				{ [exercise]: 'Bench', [kg]: 80 },
				{ [exercise]: 'Row', [kg]: 60 }
			],
			1000
		).changes
	);
	const [squat, bench] = ws.rows(table.id);
	const next = ws.fields(table.id)[2].id;
	commit([
		{ id: squat.id, kind: 'row', base: base.id, parent: table.id, set: { [next]: bench.id } }
	]);
	commit([
		{
			id: table.viewIds[0],
			kind: 'view',
			base: base.id,
			parent: table.id,
			set: { config: { hidden: [kg], sort: [{ field: exercise, dir: 'asc' }] } }
		}
	]);
	return { ws, commit, table, exercise, kg };
}

describe('duplicating', () => {
	it('copies a table whole, its own links and formulas pointing into the copy', () => {
		const { ws, commit, table } = fixture();
		const copy = duplicateTable(ws, table.id, 'Sets copy');
		commit(copy.changes);

		const fields = ws.fields(copy.id);
		expect(fields.map((field) => field.name)).toEqual(['Exercise', 'Kg', 'Next', 'Double']);
		expect(fields.every((field) => !ws.fields(table.id).some((old) => old.id === field.id))).toBe(
			true
		);
		expect(fields[2].target).toBe(copy.id);
		expect(toDisplay(fields[3].expr ?? '', fields)).toBe('"Kg" * 2');

		const rows = ws.rows(copy.id);
		expect(rows.map((row) => row.data[fields[0].id])).toEqual(['Squat', 'Bench', 'Row']);
		expect(rows[0].data[fields[2].id]).toBe(rows[1].id);

		const [grid] = ws.views(copy.id);
		expect(grid.config).toEqual({
			hidden: [fields[1].id],
			sort: [{ field: fields[0].id, dir: 'asc' }]
		});
		expect(ws.table(copy.id)?.name).toBe('Sets copy');
		expect(ws.rows(table.id)).toHaveLength(3);
	});

	it("makes a synced table's copy, and a synced field's, the person's own", () => {
		const { ws, commit, table, exercise } = fixture();
		commit([
			...updateRecord(ws, table.id, { [SOURCE]: { kind: 'rss' } }),
			...updateRecord(ws, exercise, { [PATH]: 'title' })
		]);
		const get = (id: string) => ws.get(id);
		const person = { user: 'u_me', path: 'device' } as const;

		const copy = duplicateTable(ws, table.id, 'Sets copy');
		commit(copy.changes);
		expect(canAddRows(get, person, copy.id)).toBe(true);
		const copied = ws.fields(copy.id)[0].id;
		expect(canEditValues(get, person, copy.id, copied)).toBe(true);

		const field = duplicateField(ws, exercise, 'Exercise copy');
		commit(field.changes);
		expect(canEditValues(get, person, table.id, field.id)).toBe(true);
	});

	it('copies a field and its values right after it', () => {
		const { ws, commit, table, kg } = fixture();
		const copy = duplicateField(ws, kg, 'Kg copy');
		commit(copy.changes);

		expect(ws.fields(table.id).map((field) => field.name)).toEqual([
			'Exercise',
			'Kg',
			'Kg copy',
			'Next',
			'Double'
		]);
		expect(ws.rows(table.id).map((row) => row.data[copy.id])).toEqual([100, 80, 60]);
	});

	it('copies a view and its settings right after it', () => {
		const { ws, commit, table } = fixture();
		const [grid] = ws.views(table.id);
		const copy = duplicateView(ws, grid.id, 'Grid copy');
		commit(copy.changes);

		expect(ws.views(table.id).map((view) => view.name)).toEqual(['Grid', 'Grid copy', 'Entry']);
		expect(ws.view(copy.id)?.config).toEqual(grid.config);
	});

	it('copies rows in their order right after the last of them', () => {
		const { ws, commit, table, exercise } = fixture();
		const [squat, bench] = ws.rows(table.id);
		const copy = duplicateRows(ws, table.id, [bench.id, squat.id]);
		commit(copy.changes);

		expect(ws.rows(table.id).map((row) => row.data[exercise])).toEqual([
			'Squat',
			'Bench',
			'Squat',
			'Bench',
			'Row'
		]);
		expect(ws.rows(table.id)[2].data[CREATED]).not.toBe(squat.data[CREATED]);
	});
});
