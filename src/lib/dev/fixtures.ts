import { addField, createBase, createTable, createView, insertRows } from '#lib/core/actions.ts';
import { toStored } from '#lib/core/formula.ts';
import type { Change, FieldDef } from '#lib/core/model.ts';
import type { Workspace } from '#lib/core/workspace.ts';

export type Fixture = {
	table: string;
	fields: FieldDef[];
	rows: string[];
	views: { grid: string; entry: string; list: string; chart: string };
	types: { table: string; row: string; grid: string };
};

/** Real records in memory, never saved: what /dev/ui renders its views on. */
export function seedFixture(ws: Workspace, commit: (changes: Change[]) => void): Fixture {
	const base = createBase(ws, 'Gym');
	commit(base.changes);

	const exercises = createTable(ws, base.id, 'Exercises', [{ name: 'Name', type: 'text' }]);
	commit(exercises.changes);
	const lifts = insertRows(
		ws,
		exercises.id,
		['Squat', 'Bench press', 'Deadlift'].map((name) => ({ [exercises.fieldIds[0]]: name }))
	);
	commit(lifts.changes);

	const sets = createTable(ws, base.id, 'Sets', [
		{ name: 'Date', type: 'date' },
		{ name: 'Exercise', type: 'link', target: exercises.id },
		{
			name: 'Session',
			type: 'choice',
			choices: [
				{ name: 'Push', color: 'orange' },
				{ name: 'Pull', color: 'blue' },
				{ name: 'Legs', color: 'green' }
			]
		},
		{ name: 'Kg', type: 'number', step: 2.5 },
		{ name: 'Reps', type: 'number' },
		{ name: 'Done', type: 'check' },
		{ name: 'Notes', type: 'text' }
	]);
	commit(sets.changes);
	const [date, exercise, session, kg, reps, done, notes] = sets.fieldIds;

	const volume = addField(ws, sets.id, {
		name: 'Volume',
		type: 'formula',
		expr: toStored('"Kg" * "Reps"', ws.fields(sets.id))
	});
	commit(volume.changes);

	const rows = insertRows(
		ws,
		sets.id,
		[
			['2026-10-27', 0, 'Legs', 100, 5, true, 'Felt strong'],
			['2026-10-27', 0, 'Legs', 102.5, 5, true, ''],
			['2026-10-28', 1, 'Push', 72.5, 8, true, ''],
			['2026-10-28', 1, 'Push', 75, 6, false, 'Last rep slow'],
			['2026-10-30', 2, 'Pull', 140, 3, true, ''],
			['2026-10-31T18:30', 0, 'Legs', 105, 4, false, '']
		].map(([day, lift, kind, load, count, finished, note]) => ({
			[date]: day,
			[exercise]: lifts.ids[lift as number],
			[session]: kind,
			[kg]: load,
			[reps]: count,
			[done]: finished,
			[notes]: note === '' ? null : note
		}))
	);
	commit(rows.changes);

	const list = createView(ws, sets.id, { name: 'List', type: 'list', config: { group: session } });
	commit(list.changes);
	const chart = createView(ws, sets.id, {
		name: 'Chart',
		type: 'chart',
		config: { kind: 'bar', x: date, agg: 'sum', y: kg, color: session }
	});
	commit(chart.changes);

	return {
		table: sets.id,
		fields: ws.fields(sets.id),
		rows: rows.ids,
		views: { grid: sets.viewIds[0], entry: sets.viewIds[1], list: list.id, chart: chart.id },
		types: seedTypes(ws, commit, base.id, exercises.id, lifts.ids[0])
	};
}

function seedTypes(
	ws: Workspace,
	commit: (changes: Change[]) => void,
	baseId: string,
	linked: string,
	linkedRow: string
): { table: string; row: string; grid: string } {
	const table = createTable(ws, baseId, 'Every type', [
		{ name: 'Text', type: 'text' },
		{ name: 'Long text', type: 'longtext' },
		{ name: 'Number', type: 'number', unit: 'kg' },
		{ name: 'Currency', type: 'currency', currency: 'EUR' },
		{ name: 'Percent', type: 'percent' },
		{ name: 'Rating', type: 'rating', max: 5 },
		{ name: 'Duration', type: 'duration' },
		{ name: 'Date', type: 'date' },
		{ name: 'Date and time', type: 'datetime' },
		{ name: 'Choice', type: 'choice', choices: [{ name: 'Legs', color: 'green' }] },
		{
			name: 'Multiple choice',
			type: 'choices',
			choices: [
				{ name: 'Strength', color: 'violet' },
				{ name: 'Outdoors', color: 'teal' },
				{ name: 'Morning', color: 'amber' }
			]
		},
		{ name: 'Check', type: 'check' },
		{ name: 'Link', type: 'link', target: linked },
		{ name: 'URL', type: 'url' },
		{ name: 'Email', type: 'email' },
		{ name: 'Phone', type: 'phone' }
	]);
	commit(table.changes);
	const formula = addField(ws, table.id, {
		name: 'Formula',
		type: 'formula',
		expr: toStored('"Currency" * 12', ws.fields(table.id))
	});
	commit(formula.changes);
	const values = [
		'Squat day',
		'Warm up on the bike.\nThree heavy sets.',
		102.5,
		49.9,
		12.5,
		4,
		4500,
		'2026-10-27',
		'2026-10-27T18:30',
		'Legs',
		['Strength', 'Morning'],
		true,
		linkedRow,
		'https://torsel.app',
		'coach@torsel.app',
		'+33 6 12 34 56 78'
	];
	const row = insertRows(ws, table.id, [
		Object.fromEntries(table.fieldIds.map((id, at) => [id, values[at]]))
	]);
	commit(row.changes);
	return { table: table.id, row: row.ids[0], grid: table.viewIds[0] };
}
