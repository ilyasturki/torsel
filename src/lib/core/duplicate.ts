import { PATH, SOURCE } from './access.ts';
import { newId } from './ids.ts';
import type { Change, Kind, Rec, Value } from './model.ts';
import { CREATED, DELETED } from './model.ts';
import type { Workspace } from './workspace.ts';

// A copy is the person's own: no source fills it.
function dataOf(rec: Rec): Record<string, Value> {
	const data = { ...rec.data };
	delete data[DELETED];
	delete data[SOURCE];
	delete data[PATH];
	return data;
}

// Ids are random and prefixed, so no text a person typed holds one by chance.
function remap<T extends Value>(value: T, ids: Map<string, string>): T {
	const text = JSON.stringify(value).replace(/[tfr]_[0-9a-z]{6,32}/gu, (id) => ids.get(id) ?? id);
	return JSON.parse(text) as T;
}

/** `id` placed right after `after` among its siblings, the ones after it moved along. */
function placedAfter(
	ws: Workspace,
	siblings: { id: string }[],
	after: string
): { order: number; moves: Change[] } {
	const at = siblings.findIndex((sibling) => sibling.id === after) + 1;
	const moves = siblings.slice(at).flatMap((sibling, index) => {
		const rec = ws.live(sibling.id) as Rec;
		const order = at + index + 1;
		return rec.data.order === order
			? []
			: [{ id: rec.id, kind: rec.kind, base: rec.base, parent: rec.parent, set: { order } }];
	});
	const earlier = siblings.slice(0, at).flatMap((sibling, index) => {
		const rec = ws.live(sibling.id) as Rec;
		return rec.data.order === index
			? []
			: [{ id: rec.id, kind: rec.kind, base: rec.base, parent: rec.parent, set: { order: index } }];
	});
	return { order: at, moves: [...earlier, ...moves] };
}

function made(rec: Rec, id: string, set: Record<string, Value>, parent = rec.parent): Change {
	return { id, kind: rec.kind as Kind, base: rec.base, parent, set };
}

/** A copy of the table with its fields, views and rows; a link from the table to itself points into the copy. */
export function duplicateTable(
	ws: Workspace,
	tableId: string,
	name: string
): { id: string; changes: Change[] } {
	const table = ws.live(tableId);
	if (table === undefined || table.kind !== 'table') throw new Error('table not found');

	const id = newId('t');
	const fields = ws.fields(tableId).map((field) => ws.live(field.id) as Rec);
	const views = ws.views(tableId).map((view) => ws.live(view.id) as Rec);
	const rows = ws.rows(tableId);
	const ids = new Map<string, string>([[tableId, id]]);
	for (const field of fields) ids.set(field.id, newId('f'));
	for (const row of rows) ids.set(row.id, newId('r'));

	const changes: Change[] = [
		made(table, id, {
			...dataOf(table),
			name: name.trim(),
			order: ws.nextOrder(table.base, 'table'),
			[CREATED]: Date.now()
		})
	];
	for (const rec of fields) {
		changes.push(made(rec, ids.get(rec.id) as string, remap(dataOf(rec), ids), id));
	}
	for (const rec of views) {
		changes.push(made(rec, newId('v'), remap(dataOf(rec), ids), id));
	}
	for (const rec of rows) {
		changes.push(made(rec, ids.get(rec.id) as string, remap(dataOf(rec), ids), id));
	}
	return { id, changes };
}

/** A copy of the field and its values, right after it. */
export function duplicateField(
	ws: Workspace,
	fieldId: string,
	name: string
): { id: string; changes: Change[] } {
	const field = ws.live(fieldId);
	if (field === undefined || field.kind !== 'field') throw new Error('field not found');

	const id = newId('f');
	const { order, moves } = placedAfter(ws, ws.fields(field.parent), fieldId);
	const values = ws.rows(field.parent).flatMap((row) => {
		const value = row.data[fieldId];
		return value === undefined || value === null ? [] : [made(row, row.id, { [id]: value })];
	});
	return {
		id,
		changes: [made(field, id, { ...dataOf(field), name: name.trim(), order }), ...moves, ...values]
	};
}

/** A copy of the view and its settings, right after it. */
export function duplicateView(
	ws: Workspace,
	viewId: string,
	name: string
): { id: string; changes: Change[] } {
	const view = ws.live(viewId);
	if (view === undefined || view.kind !== 'view') throw new Error('view not found');

	const id = newId('v');
	const { order, moves } = placedAfter(ws, ws.views(view.parent), viewId);
	return {
		id,
		changes: [
			made(view, id, { ...dataOf(view), name: name.trim(), order, [CREATED]: Date.now() }),
			...moves
		]
	};
}

/** Copies of the rows, in their order, right after the last of them. */
export function duplicateRows(
	ws: Workspace,
	tableId: string,
	rowIds: string[]
): { ids: string[]; changes: Change[] } {
	const ordered = ws.rows(tableId);
	const chosen = new Set(rowIds);
	const copied = ordered.filter((row) => chosen.has(row.id));
	if (copied.length === 0) return { ids: [], changes: [] };

	const createdOf = (row: Rec | undefined): number | undefined =>
		typeof row?.data[CREATED] === 'number' ? row.data[CREATED] : undefined;
	const lastAt = ordered.indexOf(copied[copied.length - 1]);
	const from = createdOf(ordered[lastAt]) ?? Date.now();
	const to = createdOf(ordered[lastAt + 1]) ?? from + copied.length + 1;
	const gap = (to - from) / (copied.length + 1);

	const ids: string[] = [];
	const changes = copied.map((row, index) => {
		const id = newId('r');
		ids.push(id);
		return made(row, id, { ...dataOf(row), [CREATED]: from + gap * (index + 1) });
	});
	return { ids, changes };
}
