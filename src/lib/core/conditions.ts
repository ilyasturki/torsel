import type { FieldDef, Rec, Value } from './model.ts';
import { isDated, isNumeric } from './model.ts';
import { todayIso } from './values.ts';

/** The Sheets vocabulary, shared by filters and colour rules. `formula` holds a stored expression and no field. */
export const OPS = [
	'empty',
	'filled',
	'is',
	'is-not',
	'contains',
	'not-contains',
	'starts',
	'ends',
	'gt',
	'gte',
	'lt',
	'lte',
	'between',
	'not-between',
	'before',
	'after',
	'any-of',
	'none-of',
	'checked',
	'unchecked',
	'formula'
] as const;

export type Op = (typeof OPS)[number];

export type Condition = { field: string | null; op: Op; value?: Value };

/** A day a date condition reads relative to today, or an ISO day. */
export const RELATIVE_DAYS = [
	'today',
	'yesterday',
	'tomorrow',
	'past-week',
	'past-month',
	'past-year'
] as const;

export type RelativeDay = (typeof RELATIVE_DAYS)[number];

export type Kind =
	'text' | 'number' | 'mixed' | 'date' | 'choice' | 'choices' | 'link' | 'check' | 'image';

export function kindOf(field: Pick<FieldDef, 'type' | 'result'>): Kind {
	const { type } = field;
	if (isNumeric(type)) return 'number';
	if (isDated(type)) return 'date';
	if (type === 'formula') {
		if (field.result === 'date') return 'date';
		return field.result === null ? 'mixed' : 'number';
	}
	if (
		type === 'choice' ||
		type === 'choices' ||
		type === 'link' ||
		type === 'check' ||
		type === 'image'
	) {
		return type;
	}
	return 'text';
}

const TEXT_OPS: Op[] = [
	'contains',
	'not-contains',
	'is',
	'is-not',
	'starts',
	'ends',
	'empty',
	'filled'
];
const NUMBER_OPS: Op[] = [
	'is',
	'is-not',
	'gt',
	'gte',
	'lt',
	'lte',
	'between',
	'not-between',
	'empty',
	'filled'
];

export const OPS_OF: Record<Kind, readonly Op[]> = {
	text: TEXT_OPS,
	number: NUMBER_OPS,
	mixed: [...NUMBER_OPS.slice(0, -2), 'contains', 'not-contains', 'empty', 'filled'],
	date: ['is', 'before', 'after', 'between', 'empty', 'filled'],
	choice: ['any-of', 'none-of', 'empty', 'filled'],
	choices: ['any-of', 'none-of', 'empty', 'filled'],
	link: ['any-of', 'none-of', 'empty', 'filled'],
	check: ['checked', 'unchecked'],
	image: ['empty', 'filled']
};

const ANY_TEXT: Op[] = ['contains', 'not-contains'];

/** What a field takes: its kind's ops, and a search of its text (the column menu's filter) wherever it reads as text. */
export function opsFor(kind: Kind): readonly Op[] {
	if (kind === 'check' || kind === 'image') return OPS_OF[kind];
	return [...OPS_OF[kind], ...ANY_TEXT.filter((op) => !OPS_OF[kind].includes(op))];
}

/** Whether the op reads a value: one, two (`between`), or a list (`any-of`). */
export function arity(op: Op): 'none' | 'one' | 'two' | 'list' {
	if (op === 'empty' || op === 'filled' || op === 'checked' || op === 'unchecked') return 'none';
	if (op === 'between' || op === 'not-between') return 'two';
	if (op === 'any-of' || op === 'none-of') return 'list';
	return 'one';
}

function isBlank(value: unknown): boolean {
	return (
		value === null ||
		value === undefined ||
		value === '' ||
		(Array.isArray(value) && value.length === 0)
	);
}

function asNumber(value: unknown): number | null {
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (typeof value === 'string' && value.trim() !== '') {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}

function addDays(iso: string, days: number): string {
	const date = new Date(`${iso}T12:00:00Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

function addMonths(iso: string, months: number): string {
	const date = new Date(`${iso}T12:00:00Z`);
	const day = date.getUTCDate();
	date.setUTCDate(1);
	date.setUTCMonth(date.getUTCMonth() + months);
	const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
	date.setUTCDate(Math.min(day, last));
	return date.toISOString().slice(0, 10);
}

/** The days a date condition's value spans, inclusive. */
export function daySpan(value: unknown, today: string): { from: string; to: string } | null {
	if (typeof value !== 'string') return null;
	switch (value) {
		case 'today':
			return { from: today, to: today };
		case 'yesterday':
			return { from: addDays(today, -1), to: addDays(today, -1) };
		case 'tomorrow':
			return { from: addDays(today, 1), to: addDays(today, 1) };
		case 'past-week':
			return { from: addDays(today, -7), to: today };
		case 'past-month':
			return { from: addMonths(today, -1), to: today };
		case 'past-year':
			return { from: addMonths(today, -12), to: today };
		default: {
			const day = value.slice(0, 10);
			return /^\d{4}-\d{2}-\d{2}$/u.test(day) ? { from: day, to: day } : null;
		}
	}
}

/** `text` is what a cell reads as on screen: text conditions search it. */
export type Reading = {
	text: (field: FieldDef, value: unknown) => string;
	today: string;
};

function pair(value: unknown): [unknown, unknown] {
	return Array.isArray(value) ? [value[0], value[1]] : [value, value];
}

function compare(cell: unknown, wanted: unknown, kind: Kind): number | null {
	const a = asNumber(cell);
	const b = asNumber(wanted);
	if (a !== null && b !== null && kind !== 'text') return a - b;
	if (kind === 'number') return null;
	if (isBlank(cell) || isBlank(wanted)) return null;
	return String(cell).localeCompare(String(wanted), undefined, {
		sensitivity: 'base',
		numeric: true
	});
}

function dayCompare(cell: unknown, op: Op, value: unknown, today: string): boolean {
	if (typeof cell !== 'string' || cell === '') return false;
	const day = cell.slice(0, 10);
	if (op === 'between') {
		const [low, high] = pair(value);
		const from = daySpan(low, today);
		const to = daySpan(high, today);
		return from !== null && to !== null && day >= from.from && day <= to.to;
	}
	const span = daySpan(value, today);
	if (span === null) return false;
	if (op === 'before') return day < span.from;
	if (op === 'after') return day > span.to;
	return day >= span.from && day <= span.to;
}

function listOf(value: unknown): string[] {
	if (Array.isArray(value)) return value.map(String);
	return isBlank(value) ? [] : [String(value)];
}

/** Whether a cell meets a condition on its field; `formula` conditions are read elsewhere. */
export function meets(
	field: FieldDef,
	cell: unknown,
	condition: Condition,
	read: Reading
): boolean {
	const kind = kindOf(field);
	const { op, value } = condition;
	switch (op) {
		case 'empty':
			return kind === 'check' ? cell !== true : isBlank(cell);
		case 'filled':
			return kind === 'check' ? cell === true : !isBlank(cell);
		case 'checked':
			return cell === true || cell === 1;
		case 'unchecked':
			return !(cell === true || cell === 1);
		case 'any-of':
		case 'none-of': {
			const wanted = new Set(listOf(value).map((item) => item.toLowerCase()));
			const has = listOf(cell).some((item) => wanted.has(item.toLowerCase()));
			return op === 'any-of' ? has : !has;
		}
		case 'contains':
		case 'not-contains':
		case 'starts':
		case 'ends': {
			const text = read.text(field, cell).toLowerCase();
			const needle = String(value ?? '').toLowerCase();
			if (op === 'starts') return text.startsWith(needle);
			if (op === 'ends') return text.endsWith(needle);
			return text.includes(needle) === (op === 'contains');
		}
		case 'before':
		case 'after':
			return dayCompare(cell, op, value, read.today);
		case 'is':
		case 'is-not': {
			let same: boolean;
			if (kind === 'date') same = dayCompare(cell, 'is', value, read.today);
			else if (kind === 'text' || kind === 'link' || kind === 'choice' || kind === 'choices')
				same =
					read.text(field, cell).trim().toLowerCase() ===
					String(value ?? '')
						.trim()
						.toLowerCase();
			else same = compare(cell, value, kind) === 0;
			return op === 'is' ? same : !same;
		}
		case 'gt':
		case 'gte':
		case 'lt':
		case 'lte': {
			const order = compare(cell, value, kind);
			if (order === null) return false;
			if (op === 'gt') return order > 0;
			if (op === 'gte') return order >= 0;
			if (op === 'lt') return order < 0;
			return order <= 0;
		}
		case 'between':
		case 'not-between': {
			if (kind === 'date')
				return dayCompare(cell, 'between', value, read.today) === (op === 'between');
			const [low, high] = pair(value);
			const above = compare(cell, low, kind);
			const below = compare(cell, high, kind);
			if (above === null || below === null) return op === 'not-between' && !isBlank(cell);
			return (above >= 0 && below <= 0) === (op === 'between');
		}
		case 'formula':
			return false;
	}
}

/** What a stored custom formula gives each row: truthy rows match. */
export type FormulaHits = (stored: string) => Map<string, unknown>;

export function truthy(value: unknown): boolean {
	if (isBlank(value)) return false;
	if (typeof value === 'number') return value !== 0;
	if (typeof value === 'string') return value !== '0' && value.toLowerCase() !== 'false';
	return value !== false;
}

export type Cells = (row: Rec, field: FieldDef) => unknown;

/** A test for one row against every condition; a condition on a field that is gone, or a bare formula, is left out. */
export function conditionTest(
	fields: Map<string, FieldDef>,
	conditions: readonly Condition[],
	cells: Cells,
	read: Reading,
	hits: FormulaHits
): (row: Rec, at?: number) => boolean {
	const tests = conditions.flatMap((condition): ((row: Rec) => boolean)[] => {
		if (condition.op === 'formula') {
			if (typeof condition.value !== 'string' || condition.value.trim() === '') return [];
			const values = hits(condition.value);
			return [(row) => truthy(values.get(row.id))];
		}
		const field = condition.field === null ? undefined : fields.get(condition.field);
		if (field === undefined) return [];
		if (arity(condition.op) !== 'none' && isBlank(condition.value)) return [];
		return [(row) => meets(field, cells(row, field), condition, read)];
	});
	return (row) => tests.every((test) => test(row));
}

export function reading(text: Reading['text']): Reading {
	return { text, today: todayIso() };
}

export type ColorRule =
	| { when: Condition; color: string }
	| { choices: string }
	// Steps of `color` over the shown rows, the lowest value lightest.
	| { scale: string; color: string };

export const SCALE_STEPS = 5;

export function scaleStep(value: number, low: number, high: number): number {
	if (high <= low) return SCALE_STEPS;
	const at = (value - low) / (high - low);
	return Math.min(SCALE_STEPS, Math.max(1, Math.floor(at * SCALE_STEPS) + 1));
}

/** `field` is the matched rule's field, for a cell-only paint; `scales` colour single cells under any rule. */
export type Paint = {
	color: string | null;
	field: string | null;
	scales: Map<string, { color: string; step: number }>;
};

/** Each row's colours; the first rule a row matches gives its colour. */
export function colorTest(
	fields: Map<string, FieldDef>,
	rules: readonly ColorRule[],
	cells: Cells,
	read: Reading,
	hits: FormulaHits,
	rows: readonly Rec[]
): (row: Rec) => Paint {
	type Match = (row: Rec) => { color: string; field: string | null } | null;
	const matches: Match[] = [];
	const scales: { field: FieldDef; color: string; low: number; high: number }[] = [];
	for (const rule of rules) {
		if ('when' in rule) {
			const test = conditionTest(fields, [rule.when], cells, read, hits);
			const field = rule.when.field;
			const valid = rule.when.op === 'formula' || (field !== null && fields.has(field));
			if (valid) matches.push((row) => (test(row) ? { color: rule.color, field } : null));
		} else if ('choices' in rule) {
			const field = fields.get(rule.choices);
			if (field === undefined) continue;
			const colors = new Map(field.choices.map((choice) => [choice.name, choice.color]));
			matches.push((row) => {
				const first = listOf(cells(row, field))[0];
				const color = first === undefined ? null : (colors.get(first) ?? null);
				return color === null ? null : { color, field: field.id };
			});
		} else {
			const field = fields.get(rule.scale);
			if (field === undefined) continue;
			const numbers = rows.map((row) => asNumber(cells(row, field))).filter((n) => n !== null);
			if (numbers.length === 0) continue;
			scales.push({
				field,
				color: rule.color,
				low: Math.min(...numbers),
				high: Math.max(...numbers)
			});
		}
	}
	return (row) => {
		let found: { color: string; field: string | null } | null = null;
		for (const match of matches) {
			found = match(row);
			if (found !== null) break;
		}
		const painted = new Map<string, { color: string; step: number }>();
		for (const scale of scales) {
			const value = asNumber(cells(row, scale.field));
			if (value !== null && !painted.has(scale.field.id)) {
				painted.set(scale.field.id, {
					color: scale.color,
					step: scaleStep(value, scale.low, scale.high)
				});
			}
		}
		return { color: found?.color ?? null, field: found?.field ?? null, scales: painted };
	};
}

export const TOTALS = ['count', 'sum', 'avg', 'min', 'max', 'checked'] as const;

export type Total = (typeof TOTALS)[number];

export function totalsFor(field: Pick<FieldDef, 'type' | 'result'>): Total[] {
	const kind = kindOf(field);
	if (kind === 'number' || kind === 'mixed') return ['sum', 'avg', 'min', 'max', 'count'];
	if (kind === 'date') return ['min', 'max', 'count'];
	if (kind === 'check') return ['checked', 'count'];
	return ['count'];
}

/** A column's total over the shown cells; `count` counts the filled ones, `checked` is a share from 0 to 1. */
export function totalOf(total: Total, cells: readonly unknown[]): number | string | null {
	if (total === 'count') return cells.filter((cell) => !isBlank(cell) && cell !== false).length;
	if (total === 'checked') {
		return cells.length === 0
			? null
			: cells.filter((cell) => cell === true || cell === 1).length / cells.length;
	}
	if (total === 'min' || total === 'max') {
		const numbers = cells.map(asNumber).filter((cell) => cell !== null);
		if (numbers.length === cells.filter((cell) => !isBlank(cell)).length && numbers.length > 0) {
			return total === 'min' ? Math.min(...numbers) : Math.max(...numbers);
		}
		const texts = cells
			.filter((cell) => !isBlank(cell))
			.map(String)
			.sort();
		return (total === 'min' ? texts[0] : texts.at(-1)) ?? null;
	}
	const numbers = cells.map(asNumber).filter((cell) => cell !== null);
	if (numbers.length === 0) return null;
	const sum = numbers.reduce((acc, cell) => acc + cell, 0);
	return total === 'sum' ? sum : sum / numbers.length;
}
