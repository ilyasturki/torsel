import { hasPath } from './access.ts';
import type { Change, Choice, FieldDef, FieldType, FormatKey, Value } from './model.ts';
import { formatSet, hasChoices, isNumeric } from './model.ts';
import { CHOICES_JOIN, coerce, durationUnit, formatDuration } from './values.ts';
import type { Workspace } from './workspace.ts';

export type Retype = {
	type: FieldType;
	target?: string | null;
	expr?: string | null;
	choices?: Choice[];
	/** How a check value reads once it is text, in the language of whoever converts it. */
	checkWords?: { yes: string; no: string };
} & Partial<Pick<FieldDef, FormatKey>>;

/** A value as the person reads it, without a locale: what a text field keeps of it. */
function asText(ws: Workspace, field: FieldDef, to: Retype, value: Value): string | null {
	if (typeof value === 'boolean') {
		return to.checkWords === undefined ? String(value) : to.checkWords[value ? 'yes' : 'no'];
	}
	if (typeof value === 'number') {
		if (field.type === 'duration') {
			return formatDuration(value, field.seconds || value % 60 !== 0);
		}
		return field.type === 'percent' ? `${value}%` : String(value);
	}
	if (Array.isArray(value)) {
		return value.filter((item) => typeof item === 'string').join(CHOICES_JOIN) || null;
	}
	if (typeof value !== 'string') {
		return null;
	}
	return field.type === 'link' ? ws.rowTitle(value) || null : value;
}

/** A number in the unit the person reads: a duration counts in its field's smallest unit. */
function asNumber(field: Pick<FieldDef, 'type' | 'seconds'>, value: number): number {
	return field.type === 'duration' ? value / durationUnit(field) : value;
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
	if (from.type === 'duration' && to.type === 'duration') {
		return coerce(to, value);
	}
	if (isNumeric(to.type) && (typeof value === 'number' || typeof value === 'boolean')) {
		const number = typeof value === 'number' ? asNumber(from, value) : value ? 1 : 0;
		return coerce(to, to.type === 'duration' ? number * durationUnit(to) : number);
	}
	if (to.type === 'check' && typeof value !== 'string') {
		return typeof value === 'boolean' ? value : value !== 0;
	}
	if (to.type === 'choices' && typeof value === 'string' && from.type === 'choice') {
		return [value];
	}

	const text = asText(ws, from, to, value);
	if (text === null) {
		return null;
	}
	return to.type === 'link' ? (titles.get(text.trim().toLowerCase()) ?? null) : coerce(to, text);
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
	return JSON.stringify(a ?? null) === JSON.stringify(b);
}

/**
 * The changes turning a field into another type or format, every value converted in one undo step,
 * and how many values have no form in the new one and are cleared. `computed` holds a formula's
 * current results by row, which become the values when it stops being a formula.
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
	const known = to.choices ?? field.choices;
	const named = new Set(known.map((choice) => choice.name));
	const found: Choice[] = [...known];
	let lost = 0;

	// A source writes its fields' values: a new format of the same type only changes how they read.
	const rows = to.type === field.type && hasPath(ws.get(fieldId)) ? [] : ws.rows(field.table);
	for (const row of rows) {
		const value = field.type === 'formula' ? computed?.get(row.id)?.[field.id] : row.data[field.id];
		if (value === null || value === undefined || value === '') {
			continue;
		}

		const next = convert(ws, field, to, value, titles);
		if (next === null && to.type !== 'formula') {
			lost += 1;
		}
		for (const name of typeof next === 'string' ? [next] : Array.isArray(next) ? next : []) {
			if (hasChoices(to.type) && typeof name === 'string' && !named.has(name)) {
				named.add(name);
				found.push({ name, color: null });
			}
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

	const set: Record<string, Value> = { type: to.type, auto: null, ...formatSet(to.type, to) };
	if (hasChoices(to.type)) {
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
