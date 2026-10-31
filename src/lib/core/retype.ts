import type { Change, Choice, FieldDef, FieldType, Value } from './model.ts';
import { parseCheck, parseDate, parseNumber } from './values.ts';
import type { Workspace } from './workspace.ts';

export type Retype = {
	type: FieldType;
	target?: string | null;
	expr?: string | null;
	choices?: Choice[];
};

function asText(ws: Workspace, field: FieldDef, value: Value): string | null {
	if (typeof value === 'boolean') {
		return value ? 'yes' : 'no';
	}
	if (typeof value === 'number') {
		return String(value);
	}
	if (typeof value !== 'string') {
		return null;
	}
	return field.type === 'link' ? ws.rowTitle(value) || null : value;
}

function convert(
	ws: Workspace,
	from: FieldDef,
	to: Retype,
	value: Value,
	titles: Map<string, string>
): Value {
	if (to.type === 'formula') {
		return null;
	}
	if (to.type === 'number' && typeof value !== 'string') {
		return typeof value === 'number' ? value : value === true ? 1 : 0;
	}
	if (to.type === 'check' && typeof value !== 'string') {
		return typeof value === 'boolean' ? value : value !== 0;
	}

	const text = asText(ws, from, value);
	if (text === null) {
		return null;
	}

	switch (to.type) {
		case 'number':
			return parseNumber(text);
		case 'date':
			return parseDate(text);
		case 'check':
			return parseCheck(text);
		case 'link':
			return titles.get(text.trim().toLowerCase()) ?? null;
		case 'choice':
			return text.trim() === '' ? null : text.trim();
		default:
			return text;
	}
}

function linkTitles(ws: Workspace, target: string | null | undefined): Map<string, string> {
	const titles = new Map<string, string>();
	if (target) {
		for (const row of ws.rows(target)) {
			const title = ws.rowTitle(row.id).trim().toLowerCase();
			if (title !== '' && !titles.has(title)) {
				titles.set(title, row.id);
			}
		}
	}
	return titles;
}

function unchanged(a: Value | undefined, b: Value): boolean {
	return (a ?? null) === b;
}

/**
 * The changes turning a field into another type, every value converted in one undo step, and how
 * many values have no form in the new type and are cleared. `computed` holds a formula's current
 * results by row, which become the values when it stops being a formula.
 */
export function retypeField(
	ws: Workspace,
	fieldId: string,
	to: Retype,
	computed?: Map<string, Record<string, Value>>
): { changes: Change[]; lost: number } {
	const field = ws.field(fieldId);
	if (field === undefined) {
		throw new Error('field not found');
	}

	const titles = to.type === 'link' ? linkTitles(ws, to.target) : new Map<string, string>();
	const changes: Change[] = [];
	const named = new Set((to.choices ?? field.choices).map((choice) => choice.name));
	const found: Choice[] = [...(to.choices ?? field.choices)];
	let lost = 0;

	for (const row of ws.rows(field.table)) {
		const value = field.type === 'formula' ? computed?.get(row.id)?.[field.id] : row.data[field.id];
		if (value === null || value === undefined || value === '') {
			continue;
		}

		const next = convert(ws, field, to, value, titles);
		if (next === null && to.type !== 'formula') {
			lost += 1;
		}
		if (to.type === 'choice' && typeof next === 'string' && !named.has(next)) {
			named.add(next);
			found.push({ name: next, color: null });
		}
		if (!unchanged(row.data[field.id], next)) {
			changes.push({
				id: row.id,
				kind: 'row',
				base: row.base,
				parent: row.parent,
				set: { [field.id]: next }
			});
		}
	}

	const set: Record<string, Value> = { type: to.type, auto: null };
	if (to.type === 'choice') {
		set.choices = found.map((choice) => ({ name: choice.name, color: choice.color }));
	}
	if (to.type === 'link') {
		set.target = to.target ?? null;
	}
	if (to.type === 'formula') {
		set.expr = to.expr ?? null;
	}

	return {
		changes: [
			{ id: field.id, kind: 'field', base: field.base, parent: field.table, set },
			...changes
		],
		lost
	};
}
