import { newId } from './ids.ts';
import type {
	Change,
	Choice,
	FieldDef,
	FieldType,
	Rec,
	Value,
	ViewConfig,
	ViewType
} from './model.ts';
import { CREATED, DELETED } from './model.ts';
import { coerce, typeOfValues } from './values.ts';
import type { Workspace } from './workspace.ts';

export type FieldSpec = {
	name: string;
	type: FieldType;
	choices?: Choice[];
	target?: string | null;
	expr?: string | null;
	description?: string | null;
	step?: number | null;
	auto?: boolean;
};

export type ViewSpec = { name: string; type: ViewType; config?: ViewConfig };

function fieldSet(spec: FieldSpec, order: number): Record<string, Value> {
	const set: Record<string, Value> = { name: spec.name.trim(), type: spec.type, order };

	if (spec.type === 'choice') {
		set.choices = (spec.choices ?? []).map((choice) => ({
			name: choice.name,
			color: choice.color
		}));
	}
	if (spec.type === 'link') {
		set.target = spec.target ?? null;
	}
	if (spec.type === 'formula') {
		set.expr = spec.expr ?? null;
	}
	if (spec.description !== undefined) {
		set.description = spec.description;
	}
	if (spec.step !== undefined) {
		set.step = spec.step;
	}
	if (spec.auto === true) {
		set.auto = true;
	}

	return set;
}

function baseChange(ws: Workspace, id: string, name: string): Change {
	return {
		id,
		kind: 'base',
		base: id,
		parent: '',
		set: { name: name.trim(), order: ws.nextOrder('', 'base') }
	};
}

export function createBase(ws: Workspace, name: string): { id: string; changes: Change[] } {
	const id = newId('b');

	return { id, changes: [baseChange(ws, id, name)] };
}

// Fixed id: two offline devices making their first table converge on one base.
const HOME_BASE = 'b_home';

export function homeBase(ws: Workspace): { id: string; changes: Change[] } {
	const existing = ws.base(HOME_BASE) ?? ws.bases()[0];
	if (existing !== undefined) {
		return { id: existing.id, changes: [] };
	}

	// Reviving a deleted home would bring back the tables hidden with it.
	return ws.get(HOME_BASE) === undefined
		? { id: HOME_BASE, changes: [baseChange(ws, HOME_BASE, 'Tables')] }
		: createBase(ws, 'Tables');
}

export const BLANK_FIELD = 'Name';

export function nextTableName(ws: Workspace): string {
	const taken = new Set(
		ws.bases().flatMap((base) => ws.tables(base.id).map((table) => table.name))
	);
	let number = 1;
	while (taken.has(`Table ${number}`)) number += 1;
	return `Table ${number}`;
}

export function blankTable(
	ws: Workspace,
	baseId?: string,
	wanted?: string
): { id: string; name: string; viewIds: string[]; changes: Change[] } {
	const home = baseId === undefined ? homeBase(ws) : { id: baseId, changes: [] };
	const name = wanted?.trim() || nextTableName(ws);
	const made = createTable(ws, home.id, name, [{ name: BLANK_FIELD, type: 'text', auto: true }]);

	return {
		id: made.id,
		name,
		viewIds: made.viewIds,
		changes: [...home.changes, ...made.changes]
	};
}

/** The field "the last time" is read on when a view does not say: the choice with the most values. */
export function defaultMatch(fields: FieldDef[]): string[] {
	const keys = fields.filter((field) => field.type === 'choice' || field.type === 'link');
	const best = keys.sort((a, b) => b.choices.length - a.choices.length)[0];
	return best === undefined ? [] : [best.id];
}

export function defaultViews(): ViewSpec[] {
	return [
		{ name: 'Grid', type: 'grid', config: {} },
		{ name: 'Entry', type: 'entry', config: {} }
	];
}

/** With no field list of its own, an entry view follows the table's fields, less the hidden ones. */
export function entryFields(all: FieldDef[], config: ViewConfig): FieldDef[] {
	const list =
		config.fields === undefined
			? all.filter((field) => !config.hidden?.includes(field.id))
			: config.fields
					.map((id) => all.find((field) => field.id === id))
					.filter((field) => field !== undefined);
	return list.filter((field) => field.type !== 'formula');
}

const blank = (value: Value | undefined): boolean =>
	value === null || value === undefined || value === '';

/** A row that leaves blank a field most rows fill was planned or skipped, not done: "last time" passes over it. */
export function doneRows(fields: FieldDef[], rows: Rec[]): (row: Rec) => boolean {
	const usual = fields.filter(
		(field) => rows.filter((row) => !blank(row.data[field.id])).length * 2 > rows.length
	);
	return (row) => usual.every((field) => !blank(row.data[field.id]));
}

export type ListLayout = {
	group: FieldDef | undefined;
	title: FieldDef | undefined;
	show: FieldDef[];
};

export function listLayout(fields: FieldDef[], config: ViewConfig): ListLayout {
	const byId = new Map(fields.map((field) => [field.id, field]));
	const group =
		config.group === null
			? undefined
			: config.group === undefined
				? (fields.find((field) => field.type === 'date') ??
					fields.find((field) => field.type === 'choice'))
				: byId.get(config.group);
	const title = config.title
		? byId.get(config.title)
		: fields.find(
				(field) => (field.type === 'text' || field.type === 'choice') && field.id !== group?.id
			);
	const show =
		config.show === undefined
			? fields.filter((field) => field.id !== group?.id && field.id !== title?.id).slice(0, 4)
			: config.show.map((id) => byId.get(id)).filter((field) => field !== undefined);

	return { group, title, show };
}

export function chartAxis(fields: FieldDef[], config: ViewConfig): string | null {
	return config.x ?? fields.find((field) => field.type === 'date')?.id ?? fields[0]?.id ?? null;
}

export function createTable(
	ws: Workspace,
	baseId: string,
	name: string,
	fields: FieldSpec[],
	views?: (fieldIds: { id: string; type: FieldType }[]) => ViewSpec[]
): { id: string; fieldIds: string[]; viewIds: string[]; changes: Change[] } {
	const id = newId('t');
	const changes: Change[] = [
		{
			id,
			kind: 'table',
			base: baseId,
			parent: baseId,
			set: { name: name.trim(), order: ws.nextOrder(baseId, 'table') }
		}
	];

	const made = fields.map((spec, order) => {
		const fieldId = newId('f');
		changes.push({
			id: fieldId,
			kind: 'field',
			base: baseId,
			parent: id,
			set: fieldSet(spec, order)
		});
		return { id: fieldId, type: spec.type };
	});

	const viewIds = (views ?? defaultViews)(made).map((spec, order) => {
		const viewId = newId('v');
		changes.push({
			id: viewId,
			kind: 'view',
			base: baseId,
			parent: id,
			set: { name: spec.name, type: spec.type, order, config: spec.config ?? {} }
		});
		return viewId;
	});

	return { id, fieldIds: made.map((field) => field.id), viewIds, changes };
}

export function addField(
	ws: Workspace,
	tableId: string,
	spec: FieldSpec
): { id: string; changes: Change[] } {
	const table = ws.table(tableId);
	if (table === undefined) {
		throw new Error('table not found');
	}

	const id = newId('f');

	return {
		id,
		changes: [
			{
				id,
				kind: 'field',
				base: table.base,
				parent: tableId,
				set: fieldSet(spec, ws.nextOrder(tableId, 'field'))
			}
		]
	};
}

export function updateRecord(ws: Workspace, id: string, set: Record<string, Value>): Change[] {
	const rec = ws.live(id);
	if (rec === undefined) {
		throw new Error('item not found');
	}

	return [{ id, kind: rec.kind, base: rec.base, parent: rec.parent, set }];
}

/** Gives each record its place in `ids`, touching only the ones that move. */
export function reorder(ws: Workspace, ids: string[]): Change[] {
	return ids.flatMap((id, order) =>
		ws.live(id)?.data.order === order ? [] : updateRecord(ws, id, { order })
	);
}

export function deleteRecords(ws: Workspace, ids: string[]): Change[] {
	return ids.flatMap((id) => updateRecord(ws, id, { [DELETED]: true }));
}

export function shifted(ids: string[], id: string, by: number): string[] {
	const from = ids.indexOf(id);
	const to = from + by;
	if (from < 0 || to < 0 || to >= ids.length) {
		return ids;
	}

	const out = ids.filter((item) => item !== id);
	out.splice(to, 0, id);
	return out;
}

/** Values keyed by field id, coerced to each field's type; unknown and computed fields dropped. */
export function rowValues(
	fields: FieldDef[],
	values: Record<string, unknown>
): Record<string, Value> {
	const out: Record<string, Value> = {};

	for (const field of fields) {
		if (field.type !== 'formula' && field.id in values) {
			out[field.id] = coerce(field, values[field.id]);
		}
	}

	return out;
}

function settleAuto(
	all: FieldDef[],
	rows: Record<string, unknown>[]
): { fields: FieldDef[]; changes: Change[] } {
	const changes: Change[] = [];

	const fields = all.map((field) => {
		const values = field.auto
			? rows
					.map((row) => row[field.id])
					.filter((value) => value !== null && value !== undefined && value !== '')
			: [];
		if (values.length === 0) {
			return field;
		}

		const type = typeOfValues(values);
		changes.push({
			id: field.id,
			kind: 'field',
			base: field.base,
			parent: field.table,
			set: { type, auto: null }
		});
		return { ...field, type };
	});

	return { fields, changes };
}

export type RowUpdate = { id: string; values: Record<string, unknown> };

/** Rows changed and added in one step, so a field nobody typed settles on all their values at once. */
export function writeRows(
	ws: Workspace,
	tableId: string,
	updates: RowUpdate[],
	inserts: Record<string, unknown>[],
	now: number = Date.now()
): { ids: string[]; changes: Change[] } {
	const table = ws.table(tableId);
	if (table === undefined) {
		throw new Error('table not found');
	}

	const { fields, changes: settled } = settleAuto(ws.fields(tableId), [
		...updates.map((update) => update.values),
		...inserts
	]);
	const ids: string[] = [];

	const updated = updates.flatMap(({ id, values }) => {
		if (ws.live(id)?.kind !== 'row') {
			throw new Error('row not found');
		}
		return updateRecord(ws, id, rowValues(fields, values));
	});

	const inserted = inserts.map((values, index): Change => {
		const id = newId('r');
		ids.push(id);

		return {
			id,
			kind: 'row',
			base: table.base,
			parent: tableId,
			// Rows inserted together keep their order even within one millisecond.
			set: { ...rowValues(fields, values), [CREATED]: now + index / 1000 }
		};
	});

	return { ids, changes: [...settled, ...updated, ...inserted] };
}

export function insertRows(
	ws: Workspace,
	tableId: string,
	rows: Record<string, unknown>[],
	now: number = Date.now()
): { ids: string[]; changes: Change[] } {
	return writeRows(ws, tableId, [], rows, now);
}

export function updateRow(ws: Workspace, rowId: string, values: Record<string, unknown>): Change[] {
	const rec = ws.live(rowId);
	if (rec === undefined || rec.kind !== 'row') {
		throw new Error('row not found');
	}

	return writeRows(ws, rec.parent, [{ id: rowId, values }], []).changes;
}

export function createView(
	ws: Workspace,
	tableId: string,
	spec: ViewSpec
): { id: string; changes: Change[] } {
	const table = ws.table(tableId);
	if (table === undefined) {
		throw new Error('table not found');
	}

	const id = newId('v');

	return {
		id,
		changes: [
			{
				id,
				kind: 'view',
				base: table.base,
				parent: tableId,
				set: {
					name: spec.name.trim(),
					type: spec.type,
					order: ws.nextOrder(tableId, 'view'),
					config: spec.config ?? {}
				}
			}
		]
	};
}
