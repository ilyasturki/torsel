import names from '#lib/i18n/names.ts';
import {
	addField,
	createBase,
	createTable,
	defaultViews,
	createView,
	insertRows,
	updateRecord,
	updateRow
} from '#lib/core/actions.ts';
import { toStored } from '#lib/core/formula.ts';
import type { Change } from '#lib/core/model.ts';
import type { Workspace } from '#lib/core/workspace.ts';

import type { Cell, Example, Prompt } from './examples.ts';
import { EXAMPLES } from './examples.ts';

export type Sample = { table: string; fields: string[] };

export function seedExample(
	ws: Workspace,
	commit: (changes: Change[]) => void,
	baseId: string,
	example: Example
): Sample {
	const table = createTable(ws, baseId, example.table, example.fields, () =>
		defaultViews(names.en)
	);
	commit(table.changes);
	commit(
		insertRows(
			ws,
			table.id,
			example.rows.map((row) => valuesOf(table.fieldIds, row))
		).changes
	);
	return { table: table.id, fields: table.fieldIds };
}

/** The sample behind the landing's tables. Only ever built in memory. */
export function seedExamples(
	ws: Workspace,
	commit: (changes: Change[]) => void,
	narrow = false
): Record<string, Sample> {
	const base = createBase(ws, 'Sample');
	commit(base.changes);
	const samples = Object.fromEntries(
		EXAMPLES.map((example) => [example.id, seedExample(ws, commit, base.id, example)])
	);
	if (narrow) {
		// A phone's width holds three columns: the choice gives way to the column the assistant adds.
		const first = EXAMPLES[0];
		const sample = samples[first.id];
		const grid = ws.views(sample.table).find((view) => view.type === 'grid');
		const choice = first.fields.findIndex((field) => field.type === 'choice');
		if (grid !== undefined && choice >= 0) {
			commit(updateRecord(ws, grid.id, { config: { hidden: [sample.fields[choice]] } }));
		}
	}
	return samples;
}

function valuesOf(fieldIds: string[], row: Cell[]): Record<string, Cell> {
	return Object.fromEntries(fieldIds.map((id, index) => [id, row[index]]));
}

/** What the assistant's own tool would write for this prompt, summary included. */
export function changesFor(
	ws: Workspace,
	example: Example,
	sample: Sample,
	prompt: Prompt
): { summary: string; changes: Change[]; view?: string } {
	const { table, fields } = sample;
	if (prompt.kind === 'formula') {
		const made = addField(ws, table, {
			name: prompt.name,
			type: 'formula',
			expr: toStored(prompt.expr, ws.fields(table))
		});
		return { summary: `New field "${prompt.name}" in ${example.table}`, changes: made.changes };
	}
	if (prompt.kind === 'rows') {
		const made = insertRows(
			ws,
			table,
			prompt.rows.map((row) => valuesOf(fields, row))
		);
		const count = prompt.rows.length;
		return {
			summary: `Add ${count} row${count === 1 ? '' : 's'} to ${example.table}`,
			changes: made.changes
		};
	}
	if (prompt.kind === 'cell') {
		const row = ws.rows(table).find((candidate) => candidate.data[fields[0]] === prompt.row);
		if (row === undefined) throw new Error(`no row ${prompt.row} in ${example.table}`);
		return {
			summary: `Change 1 row in ${example.table}`,
			changes: updateRow(ws, row.id, { [fields[prompt.field]]: prompt.value })
		};
	}
	const color = fields[example.fields.findIndex((field) => field.type === 'choice')];
	const made = createView(ws, table, {
		name: prompt.name,
		type: 'chart',
		config: {
			kind: 'bar',
			x: fields[prompt.group],
			agg: prompt.value === null ? 'count' : 'sum',
			y: prompt.value === null ? null : fields[prompt.value],
			color
		}
	});
	return {
		summary: `New view "${prompt.name}" on ${example.table}`,
		changes: made.changes,
		view: made.id
	};
}
