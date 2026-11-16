import { CREATED } from './model.ts';
import type { Change, FieldDef, FieldType, FillSpec, Rec, Value } from './model.ts';
import { CHOICES_JOIN, coerce, currencyOf, ratingScale } from './values.ts';
import type { Workspace } from './workspace.ts';

export const FILLABLE: readonly FieldType[] = [
	'text',
	'longtext',
	'number',
	'currency',
	'percent',
	'rating',
	'date',
	'choice',
	'choices',
	'check',
	'url',
	'email',
	'phone'
];

// Rows one model call fills; one call counts as one prompt.
export const FILL_BATCH = 25;

export const MAX_FILL_PROMPT = 1000;

export function canFill(type: FieldType): boolean {
	return FILLABLE.includes(type);
}

export function fillOf(value: Value | undefined): FillSpec | null {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
	const { prompt, web, auto, since } = value;
	if (typeof prompt !== 'string' || prompt.trim() === '') return null;
	return {
		prompt,
		web: web === true,
		auto: auto === true,
		since: typeof since === 'number' ? since : 0
	};
}

const STORED = /\{\{([a-z]_[a-z0-9]+)\}\}/gu;

/** `{Title}` as the person writes it becomes `{{f_…}}`, so a renamed field still reads. */
export function promptToStored(display: string, fields: Pick<FieldDef, 'id' | 'name'>[]): string {
	return display.replace(/\{([^{}]+)\}/gu, (whole, name: string) => {
		const field = fields.find((candidate) => candidate.name === name.trim());
		return field === undefined ? whole : `{{${field.id}}}`;
	});
}

export function promptToDisplay(stored: string, fields: Pick<FieldDef, 'id' | 'name'>[]): string {
	return stored.replace(STORED, (whole, id: string) => {
		const field = fields.find((candidate) => candidate.id === id);
		return field === undefined ? whole : `{${field.name}}`;
	});
}

export function promptFields(stored: string): string[] {
	return [...new Set([...stored.matchAll(STORED)].map((match) => match[1]))];
}

function empty(value: Value | undefined): boolean {
	return (
		value === undefined ||
		value === null ||
		value === '' ||
		(Array.isArray(value) && value.length === 0)
	);
}

/** The fields its prompt names, by name; a link reads as its row's title. */
export function fillInputs(
	ws: Workspace,
	field: FieldDef,
	spec: FillSpec,
	row: Rec
): Record<string, Value> {
	const inputs: Record<string, Value> = {};
	for (const id of promptFields(spec.prompt)) {
		const input = ws.field(id);
		const value = row.data[id];
		if (input === undefined || empty(value)) continue;
		inputs[input.name] =
			input.type === 'link' && typeof value === 'string' ? ws.rowTitle(value) : (value as Value);
	}
	return inputs;
}

/** Rows a fill would write: its cell empty, and every field its prompt names filled in. */
export function waitingRows(ws: Workspace, field: FieldDef, spec: FillSpec, rows: Rec[]): Rec[] {
	const needs = promptFields(spec.prompt).filter((id) => ws.field(id) !== undefined);
	return rows.filter(
		(row) => empty(row.data[field.id]) && needs.every((id) => !empty(row.data[id]))
	);
}

/** Rows made since the fill turned on whose cell nobody wrote after creating it: a fill undone or a cell emptied stays empty. */
export function newRows(field: FieldDef, spec: FillSpec, rows: Rec[]): Rec[] {
	return rows.filter((row) => {
		const at = row.data[CREATED];
		const written = row.clocks[field.id];
		return (
			(typeof at === 'number' ? at : 0) >= spec.since &&
			(written === undefined || written === row.clocks[CREATED])
		);
	});
}

export function typeText(field: FieldDef): string {
	switch (field.type) {
		case 'number':
			return field.unit === null ? 'a number' : `a number in ${field.unit}`;
		case 'currency':
			return `an amount in ${currencyOf(field)}, as a number`;
		case 'percent':
			return 'a percentage as a number of points, 25 for 25%';
		case 'rating': {
			const scale = ratingScale(field);
			return `a number from ${scale.min} to ${scale.max}`;
		}
		case 'date':
			return 'a date as YYYY-MM-DD';
		case 'choice':
			return `exactly one of: ${field.choices.map((choice) => choice.name).join(CHOICES_JOIN)}`;
		case 'choices':
			return `one or more of, separated by "; ": ${field.choices.map((choice) => choice.name).join(CHOICES_JOIN)}`;
		case 'check':
			return 'true or false';
		case 'url':
			return 'a link starting with https://';
		case 'email':
			return 'an email address';
		case 'phone':
			return 'a phone number';
		case 'longtext':
			return 'text, a few sentences at most';
		default:
			return 'a short text';
	}
}

/** The model's answer as the field stores it, or undefined: a choice must be one the field has. */
export function fillValue(field: FieldDef, raw: string | null): Value | undefined {
	if (raw === null || raw.trim() === '') return undefined;
	const known = (name: string): string | undefined =>
		field.choices.find((choice) => choice.name.toLowerCase() === name.trim().toLowerCase())?.name;
	if (field.type === 'choice') return known(raw);
	if (field.type === 'choices') {
		const names = raw
			.split(';')
			.map(known)
			.filter((name) => name !== undefined);
		return names.length === 0 ? undefined : [...new Set(names)];
	}
	const value = coerce(field, raw.trim());
	return value === null ? undefined : value;
}

/** The writes for what came back, to the cells still empty when it lands. */
export function fillChanges(
	ws: Workspace,
	field: FieldDef,
	values: { row: string; value: string | null }[]
): Change[] {
	const changes: Change[] = [];
	for (const { row, value } of values) {
		const rec = ws.live(row);
		if (rec === undefined || rec.parent !== field.table || !empty(rec.data[field.id])) continue;
		const stored = fillValue(field, value);
		if (stored === undefined) continue;
		changes.push({
			id: rec.id,
			kind: 'row',
			base: rec.base,
			parent: rec.parent,
			set: { [field.id]: stored }
		});
	}
	return changes;
}
