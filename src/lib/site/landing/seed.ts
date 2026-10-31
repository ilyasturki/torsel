import { addField, createBase, createTable, createView, insertRows } from '#lib/core/actions.ts';
import { toStored } from '#lib/core/formula.ts';
import type { Change } from '#lib/core/model.ts';
import type { Workspace } from '#lib/core/workspace.ts';

import { EXAMPLES, choiceIndex, numberIndex, type Example } from './examples.ts';

export type SampleViews = {
	table: string;
	column: string;
	fields: string[];
	grid: string;
	entry: string;
	list: string;
	chart: string;
};

export function seedExample(
	ws: Workspace,
	commit: (changes: Change[]) => void,
	baseId: string,
	example: Example
): SampleViews {
	const table = createTable(ws, baseId, example.table, example.fields);
	commit(table.changes);

	const column = addField(ws, table.id, {
		name: example.column.name,
		type: 'formula',
		expr: toStored(example.column.expr, ws.fields(table.id))
	});
	commit(column.changes);

	commit(
		insertRows(
			ws,
			table.id,
			example.rows.map((row) =>
				Object.fromEntries(table.fieldIds.map((id, index) => [id, row[index]]))
			)
		).changes
	);

	const group = table.fieldIds[choiceIndex(example)];
	const list = createView(ws, table.id, { name: 'List', type: 'list', config: { group } });
	commit(list.changes);

	const number = numberIndex(example);
	const chart = createView(ws, table.id, {
		name: 'Chart',
		type: 'chart',
		config: {
			kind: 'bar',
			x: group,
			agg: number < 0 ? 'count' : 'sum',
			y: number < 0 ? null : table.fieldIds[number],
			color: group
		}
	});
	commit(chart.changes);

	return {
		table: table.id,
		column: column.id,
		fields: table.fieldIds,
		grid: table.viewIds[0],
		entry: table.viewIds[1],
		list: list.id,
		chart: chart.id
	};
}

/** The sample behind the landing's working table. Only ever built in memory. */
export function seedExamples(
	ws: Workspace,
	commit: (changes: Change[]) => void
): Record<string, SampleViews> {
	const base = createBase(ws, 'Sample');
	commit(base.changes);
	return Object.fromEntries(
		EXAMPLES.map((example) => [example.id, seedExample(ws, commit, base.id, example)])
	);
}
