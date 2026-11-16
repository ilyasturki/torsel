import type { Hlc } from './clock.ts';
import { toDisplay } from './formula.ts';
import { latestClock } from './merge.ts';
import type { Change, Choice, FieldDef, Kind, Rec, SortKey, Value, ViewConfig } from './model.ts';
import { CREATED, DELETED, sortsOf } from './model.ts';
import type { ThreadAction } from './thread.ts';
import type { Workspace } from './workspace.ts';
import { fieldDef } from './workspace.ts';

export type Cell = { field: FieldDef; before: Value | undefined; after: Value | undefined };

export type RowDiff = { id: string; title: string; cells: Cell[] };

export type TableRows = {
	id: string;
	name: string;
	added: RowDiff[];
	changed: RowDiff[];
	removed: RowDiff[];
};

type Structure = Exclude<Kind, 'row'>;

/** A config value as the card words it: plain text, or a shape whose words are the reader's. */
export type Shown =
	| string
	| { none: true }
	| { sort: { field: string; ascending: boolean }[] }
	| { filter: string; text: string };

/** `label` is the changed key (`name`, `sort`, `newChoices`…), worded by the card. */
export type Line = { label: string; before: Shown; after: Shown };

/** A field's or view's type, or how many rows a deleted table held. */
export type Note = { type: string } | { rows: number } | null;

export type Diff = {
	made: { kind: Structure; id: string; name: string; note: Note }[];
	gone: { kind: Structure; id: string; name: string; note: Note; values: RowDiff[] }[];
	edits: { kind: Structure; id: string; name: string; lines: Line[] }[];
	tables: TableRows[];
};

const HIDDEN_KEYS = new Set([DELETED, CREATED, 'order', 'widths', 'auto']);

function recOf(change: Change, data: Record<string, Value>): Rec {
	return {
		id: change.id,
		kind: change.kind,
		base: change.base,
		parent: change.parent,
		data,
		clocks: {}
	};
}

function nameOf(data: Record<string, Value> | undefined, fallback: string): string {
	return typeof data?.name === 'string' && data.name !== '' ? data.name : fallback;
}

/** Fields by id, as the workspace keeps them (deleted ones included), else as this action made them. */
function fieldsOf(ws: Workspace, action: ThreadAction): (id: string) => FieldDef | undefined {
	const made = new Map(
		action.changes.filter((change) => change.kind === 'field').map((change) => [change.id, change])
	);
	return (id) => {
		const rec = ws.get(id);
		if (rec !== undefined && rec.kind === 'field') return fieldDef(rec);
		const change = made.get(id);
		return change === undefined ? undefined : fieldDef(recOf(change, change.set));
	};
}

function choiceNames(value: Value | undefined): string[] {
	return Array.isArray(value) ? (value as Choice[]).map((choice) => choice.name) : [];
}

function configText(
	key: string,
	value: Value | undefined,
	fieldName: (id: string) => string
): Shown {
	if (value === undefined || value === null) return { none: true };
	if (key === 'sort') {
		const sort = sortsOf({ sort: value as SortKey[] });
		return sort.length === 0
			? { none: true }
			: {
					sort: sort.map((item) => ({
						field: fieldName(item.field),
						ascending: item.dir === 'asc'
					}))
				};
	}
	if (key === 'filter' && typeof value === 'object' && !Array.isArray(value)) {
		const filter = value as { field: string; text: string };
		return { filter: fieldName(filter.field), text: filter.text };
	}
	if (Array.isArray(value)) {
		return value.length === 0
			? { none: true }
			: value.map((item) => fieldName(String(item))).join(', ');
	}
	if (typeof value === 'string') return value.startsWith('f_') ? fieldName(value) : value;
	return String(value);
}

function structureLines(
	ws: Workspace,
	change: Change,
	before: Record<string, Value>,
	field: (id: string) => FieldDef | undefined
): Line[] {
	const fieldName = (id: string): string => field(id)?.name ?? id;
	const lines: Line[] = [];
	for (const [key, after] of Object.entries(change.set)) {
		if (HIDDEN_KEYS.has(key)) continue;
		const prior = before[key];
		if (JSON.stringify(prior ?? null) === JSON.stringify(after ?? null)) continue;
		if (key === 'choices') {
			const was = choiceNames(prior);
			const now = choiceNames(after);
			const added = now.filter((name) => !was.includes(name));
			const removed = was.filter((name) => !now.includes(name));
			if (added.length > 0)
				lines.push({ label: 'newChoices', before: '', after: added.join(', ') });
			if (removed.length > 0)
				lines.push({ label: 'removedChoices', before: removed.join(', '), after: '' });
		} else if (key === 'config') {
			const was = (prior ?? {}) as ViewConfig & Record<string, Value>;
			const now = (after ?? {}) as ViewConfig & Record<string, Value>;
			for (const part of new Set([...Object.keys(was), ...Object.keys(now)])) {
				if (HIDDEN_KEYS.has(part)) continue;
				if (JSON.stringify(was[part] ?? null) === JSON.stringify(now[part] ?? null)) continue;
				lines.push({
					label: part,
					before: configText(part, was[part], fieldName),
					after: configText(part, now[part], fieldName)
				});
			}
		} else if (key === 'expr') {
			const fields = ws.fields(change.parent);
			const shown = (value: Value | undefined): string =>
				typeof value === 'string' ? toDisplay(value, fields) : '';
			lines.push({ label: key, before: shown(prior), after: shown(after) });
		} else if (key === 'target') {
			const table = (value: Value | undefined): string =>
				typeof value === 'string' ? nameOf(ws.get(value)?.data, value) : '';
			lines.push({ label: key, before: table(prior), after: table(after) });
		} else {
			const text = (value: Value | undefined): string =>
				value === undefined || value === null ? '' : String(value);
			lines.push({ label: key, before: text(prior), after: text(after) });
		}
	}
	return lines;
}

function noteOf(change: Change, data: Record<string, Value>): Note {
	if (change.kind === 'field' || change.kind === 'view') {
		return typeof data.type === 'string' ? { type: data.type } : null;
	}
	return null;
}

function titleOf(
	ws: Workspace,
	tableId: string,
	data: Record<string, Value>,
	field: (id: string) => FieldDef | undefined
): string {
	const fields = ws.fields(tableId);
	const primary = fields.find((candidate) => candidate.type === 'text') ?? fields[0];
	const value = primary === undefined ? undefined : data[primary.id];
	if (typeof value === 'string' && value !== '') return value;
	// A table this very action made has no fields in the workspace yet.
	const first = Object.keys(data).find((key) => field(key)?.type === 'text');
	return first === undefined ? '' : String(data[first] ?? '');
}

function cellsOf(
	data: Record<string, Value>,
	prior: Record<string, Value> | null,
	field: (id: string) => FieldDef | undefined,
	order: (id: string) => number
): Cell[] {
	const keys = Object.keys(data).filter((key) => !HIDDEN_KEYS.has(key) && field(key) !== undefined);
	return keys
		.sort((a, b) => order(a) - order(b))
		.map((key) => ({
			field: field(key) as FieldDef,
			before: prior === null ? undefined : prior[key],
			after: data[key]
		}))
		.filter(
			(cell) =>
				prior === null || JSON.stringify(cell.before ?? null) !== JSON.stringify(cell.after ?? null)
		);
}

/** What one action changed, readable as a before and after. */
export function diffOf(ws: Workspace, action: ThreadAction): Diff {
	const field = fieldsOf(ws, action);
	const order = (id: string): number => field(id)?.order ?? 0;
	// `before` runs last change first, so a record's earliest values come last and win.
	const before = new Map<string, Record<string, Value>>();
	for (const change of action.before) {
		before.set(change.id, { ...before.get(change.id), ...change.set });
	}

	const diff: Diff = { made: [], gone: [], edits: [], tables: [] };
	const tables = new Map<string, TableRows>();
	const tableRows = (id: string): TableRows => {
		let found = tables.get(id);
		if (found === undefined) {
			const made = action.changes.find((change) => change.id === id);
			found = {
				id,
				name: nameOf(ws.get(id)?.data ?? made?.set, 'table'),
				added: [],
				changed: [],
				removed: []
			};
			tables.set(id, found);
		}
		return found;
	};

	for (const change of action.changes) {
		const prior = before.get(change.id) ?? {};
		const created = prior[DELETED] === true;
		const deleted = change.set[DELETED] === true;

		if (change.kind === 'row') {
			const rows = tableRows(change.parent);
			if (created) {
				rows.added.push({
					id: change.id,
					title: titleOf(ws, change.parent, change.set, field),
					cells: cellsOf(change.set, null, field, order)
				});
			} else if (deleted) {
				rows.removed.push({
					id: change.id,
					title: titleOf(ws, change.parent, prior, field),
					cells: cellsOf(prior, null, field, order)
				});
			} else {
				const current = { ...ws.get(change.id)?.data, ...prior };
				rows.changed.push({
					id: change.id,
					title: titleOf(ws, change.parent, current, field),
					cells: cellsOf(change.set, prior, field, order)
				});
			}
			continue;
		}

		const kind = change.kind;
		if (created) {
			diff.made.push({
				kind,
				id: change.id,
				name: nameOf(change.set, kind),
				note: noteOf(change, change.set)
			});
		} else if (deleted) {
			const values =
				kind === 'field'
					? ws
							.rows(change.parent)
							.filter((row) => row.data[change.id] != null && row.data[change.id] !== '')
							.map((row) => ({
								id: row.id,
								title: titleOf(ws, change.parent, row.data, field),
								cells: [
									{
										field: field(change.id) as FieldDef,
										before: row.data[change.id],
										after: undefined
									}
								]
							}))
					: [];
			diff.gone.push({
				kind,
				id: change.id,
				name: nameOf(prior, kind),
				note: kind === 'table' ? { rows: ws.rows(change.id).length } : noteOf(change, prior),
				values
			});
		} else {
			const lines = structureLines(ws, change, prior, field);
			if (lines.length > 0) {
				const data = { ...ws.get(change.id)?.data, ...prior };
				diff.edits.push({ kind, id: change.id, name: nameOf(data, kind), lines });
			}
		}
	}

	// A new field's creation already says what its first choices are.
	const made = new Set(diff.made.map((item) => item.id));
	diff.edits = diff.edits.filter((edit) => !made.has(edit.id));
	diff.tables = [...tables.values()];
	return diff;
}

/** Stamps changes past what they touch; their before-values, a deletion's being its whole record. */
export function stampAll(ws: Workspace, hlc: Hlc, changes: Change[]): Change[] {
	const before: Change[] = [];
	for (const change of changes) {
		const existing = ws.get(change.id);
		const prior = existing === undefined ? undefined : { ...existing.data };
		if (existing !== undefined) {
			hlc.observe(latestClock(existing));
		}
		const { inverse } = ws.stamp(change, hlc.tick());
		before.unshift(
			change.set[DELETED] === true && prior !== undefined
				? { ...inverse, set: { ...prior, [DELETED]: prior[DELETED] ?? null } }
				: inverse
		);
	}
	return before;
}
