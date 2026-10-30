import { newId } from './ids.ts';
import type { Change, Choice, FieldDef, FieldType, Value, ViewConfig, ViewType } from './model.ts';
import { CREATED, DELETED } from './model.ts';
import { coerce } from './values.ts';
import type { Workspace } from './workspace.ts';

export type FieldSpec = {
	name: string;
	type: FieldType;
	choices?: Choice[];
	target?: string | null;
	expr?: string | null;
	description?: string | null;
	step?: number | null;
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

/** The field "the last time" is read on when a view does not say: the choice with the most values. */
export function defaultMatch(fields: FieldDef[]): string[] {
	const keys = fields.filter((field) => field.type === 'choice' || field.type === 'link');
	const best = keys.sort((a, b) => b.choices.length - a.choices.length)[0];
	return best === undefined ? [] : [best.id];
}

export function defaultViews(): ViewSpec[] {
	return [
		{ name: 'Grille', type: 'grid', config: {} },
		{ name: 'Saisie', type: 'entry', config: {} }
	];
}

/** With no field list of its own, an entry view follows the table's fields. */
export function entryFields(all: FieldDef[], config: ViewConfig): FieldDef[] {
	const list =
		config.fields === undefined
			? all
			: config.fields
					.map((id) => all.find((field) => field.id === id))
					.filter((field) => field !== undefined);
	return list.filter((field) => field.type !== 'formula');
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
		throw new Error('table introuvable');
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
		throw new Error('élément introuvable');
	}

	return [{ id, kind: rec.kind, base: rec.base, parent: rec.parent, set }];
}

export function deleteRecords(ws: Workspace, ids: string[]): Change[] {
	return ids.flatMap((id) => updateRecord(ws, id, { [DELETED]: true }));
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

export function insertRows(
	ws: Workspace,
	tableId: string,
	rows: Record<string, unknown>[],
	now: number = Date.now()
): { ids: string[]; changes: Change[] } {
	const table = ws.table(tableId);
	if (table === undefined) {
		throw new Error('table introuvable');
	}

	const fields = ws.fields(tableId);
	const ids: string[] = [];

	const changes = rows.map((values, index): Change => {
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

	return { ids, changes };
}

export function updateRow(ws: Workspace, rowId: string, values: Record<string, unknown>): Change[] {
	const rec = ws.live(rowId);
	if (rec === undefined || rec.kind !== 'row') {
		throw new Error('ligne introuvable');
	}

	return updateRecord(ws, rowId, rowValues(ws.fields(rec.parent), values));
}

export function createView(
	ws: Workspace,
	tableId: string,
	spec: ViewSpec
): { id: string; changes: Change[] } {
	const table = ws.table(tableId);
	if (table === undefined) {
		throw new Error('table introuvable');
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
