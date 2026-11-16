import type { Change, Kind, Rec } from './model.ts';
import { CREATED, DELETED } from './model.ts';

/** The way a write reaches the records. */
export type Path = 'device' | 'mcp' | 'assistant' | 'connector' | 'api';

// `readOnly`: the visitor of a published view, who may write nothing.
export type Actor = { user: string; path: Path; readOnly?: boolean };

export type Lookup = (id: string) => Rec | undefined;

export type Target = { id: string; kind: Kind; parent: string };

// Set by a connector only: a table's `source` says where its rows come from, a field's `path` where in each row.
export const SOURCE = 'source';
export const PATH = 'path';

export function hasSource(table: Rec | undefined): boolean {
	return table?.kind === 'table' && table.data[SOURCE] != null;
}

export function hasPath(field: Rec | undefined): boolean {
	const path = field?.kind === 'field' ? field.data[PATH] : undefined;
	return typeof path === 'string' && path !== '';
}

function locked(
	get: Lookup,
	kind: Kind,
	parent: string,
	stored: Rec | undefined,
	key: string
): boolean {
	if (kind === 'table') {
		return key === SOURCE;
	}
	if (kind === 'field') {
		return key === PATH || (key === 'type' && hasPath(stored));
	}
	if (kind !== 'row' || !hasSource(get(parent))) {
		return false;
	}
	return stored === undefined || key === DELETED || key === CREATED || hasPath(get(key));
}

/** The keys of `target` that `actor` may not write; a stored record's own kind and parent override the write's. */
export function lockedKeys(
	get: Lookup,
	actor: Actor,
	target: Target,
	keys: Iterable<string>
): string[] {
	if (actor.readOnly === true) {
		return [...keys];
	}
	if (actor.path === 'connector') {
		return [];
	}
	const stored = get(target.id);
	const kind = stored?.kind ?? target.kind;
	const parent = stored?.parent ?? target.parent;
	return [...keys].filter((key) => locked(get, kind, parent, stored, key));
}

export function canWrite(
	get: Lookup,
	actor: Actor,
	target: Target,
	keys: Iterable<string>
): boolean {
	return lockedKeys(get, actor, target, keys).length === 0;
}

/** Whether `actor` may add rows to the table: creating one writes its creation time first. */
export function canAddRows(get: Lookup, actor: Actor, tableId: string): boolean {
	return canWrite(get, actor, { id: '', kind: 'row', parent: tableId }, [CREATED]);
}

/** Whether `actor` may write a field's values in the table's existing rows. */
export function canEditValues(
	get: Lookup,
	actor: Actor,
	tableId: string,
	fieldId: string
): boolean {
	const row: Rec = { id: '', kind: 'row', base: '', parent: tableId, data: {}, clocks: {} };
	return canWrite((id) => (id === row.id ? row : get(id)), actor, row, [fieldId]);
}

/** The change with what `actor` may not write taken out; null when nothing is left. */
export function allowed(get: Lookup, actor: Actor, change: Change): Change | null {
	const refused = lockedKeys(get, actor, change, Object.keys(change.set));
	if (refused.length === 0) {
		return change;
	}
	const set = { ...change.set };
	for (const key of refused) {
		delete set[key];
	}
	return Object.keys(set).length === 0 ? null : { ...change, set };
}
