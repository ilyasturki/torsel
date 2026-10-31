import type { Change, Rec, Value } from './model.ts';
import { DELETED, KINDS, isDeleted, isRec } from './model.ts';
import type { Workspace } from './workspace.ts';

const FORMAT = 'torsel';

export function exportOf(ws: Workspace, now: Date = new Date()): string {
	return JSON.stringify({
		format: FORMAT,
		version: 1,
		exportedAt: now.toISOString(),
		records: [...ws.records.values()]
	});
}

export function parseExport(text: string): Rec[] | null {
	let payload: unknown;
	try {
		payload = JSON.parse(text);
	} catch {
		return null;
	}

	if (typeof payload !== 'object' || payload === null) {
		return null;
	}

	const { format, records } = payload as { format?: unknown; records?: unknown };

	return format === FORMAT && Array.isArray(records) && records.every((rec) => isRec(rec))
		? records
		: null;
}

function differs(a: Value | undefined, b: Value): boolean {
	return JSON.stringify(a ?? null) !== JSON.stringify(b);
}

export function restoreChanges(ws: Workspace, records: Rec[]): Change[] {
	const ordered = [...records].sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind));
	const changes: Change[] = [];

	for (const rec of ordered) {
		const local = ws.get(rec.id);
		if (
			(local === undefined && isDeleted(rec)) ||
			(local !== undefined && local.kind !== rec.kind)
		) {
			continue;
		}

		const set: Record<string, Value> = {};
		for (const [key, value] of Object.entries(rec.data)) {
			if (differs(local?.data[key], value)) {
				set[key] = value;
			}
		}
		if (local !== undefined && isDeleted(local) && !isDeleted(rec)) {
			set[DELETED] = null;
		}

		if (Object.keys(set).length > 0) {
			changes.push({ id: rec.id, kind: rec.kind, base: rec.base, parent: rec.parent, set });
		}
	}

	return changes;
}
