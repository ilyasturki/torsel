import type { ChartData } from './chart.ts';
import type { Change, Value, ViewConfig } from './model.ts';
import { CREATED } from './model.ts';
import type { SqlRow } from './sql.ts';

export const PUBLISHED_TYPES = ['grid', 'list', 'chart'] as const;

export type PublishedType = (typeof PUBLISHED_TYPES)[number];

export function isPublishable(type: string): type is PublishedType {
	return (PUBLISHED_TYPES as readonly string[]).includes(type);
}

/** A view as its public link shows it: every id is minted for the payload, and nothing the view hides is in it. */
export type Published = {
	base: { id: string; name: string };
	table: { id: string; name: string };
	view: { id: string; name: string; type: PublishedType; config: ViewConfig };
	fields: { id: string; data: Record<string, Value> }[];
	// In the order shown; a formula's value is in `values` under its field.
	rows: { id: string; values: Record<string, Value> }[];
	// What a link field points to: a table of one text field holding each row's title.
	targets: { id: string; field: string; rows: { id: string; title: string }[] }[];
	chart: ChartData | null;
};

export type Opened = {
	changes: Change[];
	computed: Map<string, SqlRow>;
};

/** The records a link's page holds, and the formula values it shows as given. */
export function openPublished(published: Published): Opened {
	const { base, table, view } = published;
	const changes: Change[] = [
		{ id: base.id, kind: 'base', base: base.id, parent: '', set: { name: base.name, order: 0 } },
		{
			id: table.id,
			kind: 'table',
			base: base.id,
			parent: base.id,
			set: { name: table.name, order: 0 }
		}
	];

	for (const target of published.targets) {
		changes.push(
			{ id: target.id, kind: 'table', base: base.id, parent: base.id, set: { name: '', order: 1 } },
			{
				id: target.field,
				kind: 'field',
				base: base.id,
				parent: target.id,
				set: { name: '', type: 'text', order: 0 }
			},
			...target.rows.map((row, at): Change => ({
				id: row.id,
				kind: 'row',
				base: base.id,
				parent: target.id,
				set: { [target.field]: row.title, [CREATED]: at }
			}))
		);
	}

	const formulas = new Set<string>();
	for (const field of published.fields) {
		if (field.data.type === 'formula') formulas.add(field.id);
		changes.push({
			id: field.id,
			kind: 'field',
			base: base.id,
			parent: table.id,
			set: field.data
		});
	}

	changes.push({
		id: view.id,
		kind: 'view',
		base: base.id,
		parent: table.id,
		set: {
			name: view.name,
			type: view.type,
			order: 0,
			config: JSON.parse(JSON.stringify(view.config)) as Value
		}
	});

	const computed = new Map<string, SqlRow>();
	for (const [at, row] of published.rows.entries()) {
		const set: Record<string, Value> = { [CREATED]: at };
		const given: SqlRow = {};
		for (const [key, value] of Object.entries(row.values)) {
			if (formulas.has(key)) given[key] = value as SqlRow[string];
			else set[key] = value;
		}
		if (formulas.size > 0) computed.set(row.id, given);
		changes.push({ id: row.id, kind: 'row', base: base.id, parent: table.id, set });
	}

	return { changes, computed };
}
