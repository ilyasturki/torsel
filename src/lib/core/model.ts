import type { Clock } from './clock.ts';
import { isClock } from './clock.ts';
import type { ColorRule, Condition, Total } from './conditions.ts';

export const KINDS = ['base', 'table', 'field', 'view', 'row'] as const;

export type Kind = (typeof KINDS)[number];

export type Value = string | number | boolean | null | Value[] | { [key: string]: Value };

// Each key in `data` has its own clock; `base` and `parent` never change after creation.
export type Rec = {
	id: string;
	kind: Kind;
	base: string;
	parent: string;
	data: Record<string, Value>;
	clocks: Record<string, Clock>;
};

export type Change = {
	id: string;
	kind: Kind;
	base: string;
	parent: string;
	set: Record<string, Value>;
};

export const DELETED = '_del';

// Creation time in ms: the order "the last time" reads in.
export const CREATED = '_at';

export function isDeleted(rec: Rec): boolean {
	return rec.data[DELETED] === true;
}

export const FIELD_TYPES = [
	'text',
	'longtext',
	'number',
	'currency',
	'percent',
	'rating',
	'duration',
	'date',
	'datetime',
	'choice',
	'choices',
	'check',
	'link',
	'url',
	'email',
	'phone',
	'image',
	'formula'
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

const NUMERIC: readonly FieldType[] = ['number', 'currency', 'percent', 'rating', 'duration'];

/** Held as a number: right-aligned, summed and charted. */
export function isNumeric(type: FieldType): boolean {
	return NUMERIC.includes(type);
}

export function isDated(type: FieldType): boolean {
	return type === 'date' || type === 'datetime';
}

export function hasChoices(type: FieldType): boolean {
	return type === 'choice' || type === 'choices';
}

export function isContact(type: FieldType): boolean {
	return type === 'url' || type === 'email' || type === 'phone';
}

export const VIEW_TYPES = ['grid', 'entry', 'list', 'chart'] as const;

export type ViewType = (typeof VIEW_TYPES)[number];

export type Choice = { name: string; color: string | null };

export type BaseDef = { id: string; name: string; order: number };

export type TableDef = { id: string; base: string; name: string; order: number };

/** How a date reads: `short` is "28 Dec", with its year when not this year. */
export const DATE_STYLES = ['short', 'numeric', 'weekday', 'long', 'iso'] as const;

export type DateStyleName = (typeof DATE_STYLES)[number];

/** The type whose look a formula's result takes. */
export const RESULT_TYPES = ['number', 'currency', 'percent', 'date'] as const;

export type ResultType = (typeof RESULT_TYPES)[number];

export type FieldDef = {
	id: string;
	base: string;
	table: string;
	name: string;
	type: FieldType;
	order: number;
	choices: Choice[];
	target: string | null;
	expr: string | null;
	description: string | null;
	// The plus and minus of a number, the smallest move of a rating.
	step: number | null;
	decimals: number | null;
	grouping: boolean;
	unit: string | null;
	currency: string | null;
	min: number | null;
	max: number | null;
	seconds: boolean;
	dateStyle: DateStyleName | null;
	result: ResultType | null;
	// Nobody has chosen a type yet: the first values settle it.
	auto: boolean;
	// The model fills it per row from a prompt over the row's other fields.
	fill: FillSpec | null;
};

/** A field the model fills per row: `prompt` names other fields as {{field id}}. */
export type FillSpec = {
	prompt: string;
	web: boolean;
	// New rows get their value on their own, once their inputs are in: rows made from `since` (ms) on.
	auto: boolean;
	since: number;
};

export const FORMAT_KEYS = [
	'step',
	'decimals',
	'grouping',
	'unit',
	'currency',
	'min',
	'max',
	'seconds',
	'dateStyle',
	'result'
] as const;

export type FormatKey = (typeof FORMAT_KEYS)[number];

export type FieldFormat = Pick<FieldDef, 'type'> & Partial<Pick<FieldDef, FormatKey>>;

/** The format keys each type reads; the rest stay null on it. */
export const FORMAT_OF: Record<FieldType, readonly FormatKey[]> = {
	text: [],
	longtext: [],
	number: ['decimals', 'grouping', 'unit', 'step'],
	currency: ['currency', 'decimals'],
	percent: ['decimals'],
	rating: ['min', 'max', 'step'],
	duration: ['seconds'],
	date: ['dateStyle'],
	datetime: ['dateStyle'],
	choice: [],
	choices: [],
	check: [],
	link: [],
	url: [],
	email: [],
	phone: [],
	image: [],
	formula: ['result', 'decimals', 'currency', 'dateStyle']
};

/** A type's format keys from `options`, every other key cleared so no stale one comes back. */
export function formatSet(
	type: FieldType,
	options: Partial<Pick<FieldDef, FormatKey>>
): Record<FormatKey, Value> {
	const set = Object.fromEntries(FORMAT_KEYS.map((key) => [key, null])) as Record<FormatKey, Value>;
	for (const key of FORMAT_OF[type]) {
		set[key] = options[key] ?? null;
	}
	return set;
}

export type SortKey = { field: string; dir: 'asc' | 'desc' };

export type GridConfig = {
	hidden?: string[];
	// The first key orders the rows, each next one breaks the ties left.
	sort?: SortKey[] | null;
	widths?: Record<string, number>;
	// Rows three times as tall: larger images, text on up to three lines.
	tall?: boolean;
	colors?: ColorRule[];
	totals?: Record<string, Total>;
};

/** Every view but Saisie shows only the rows meeting all of them. */
export type FilterConfig = { filters?: Condition[] };

export type EntryConfig = { fields?: string[]; match?: string[] };

export type ListConfig = {
	group?: string | null;
	title?: string | null;
	show?: string[];
	// An image field: its first image tops each row, and the list lays out as cards.
	cover?: string | null;
};

export type ChartConfig = {
	kind?: 'bar' | 'line';
	x?: string | null;
	bucket?: 'day' | 'week' | 'month' | null;
	agg?: 'count' | 'sum' | 'avg' | 'max' | 'min';
	y?: string | null;
	color?: string | null;
	rolling?: number | null;
};

export type ViewConfig = FilterConfig & GridConfig & EntryConfig & ListConfig & ChartConfig;

export type ViewDef = {
	id: string;
	base: string;
	table: string;
	name: string;
	type: ViewType;
	order: number;
	config: ViewConfig;
};

export function sortsOf(config: GridConfig): SortKey[] {
	return Array.isArray(config.sort) ? config.sort : [];
}

export function isKind(value: unknown): value is Kind {
	return typeof value === 'string' && (KINDS as readonly string[]).includes(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isRec(value: unknown): value is Rec {
	if (!isPlainObject(value)) {
		return false;
	}

	const { id, kind, base, parent, data, clocks } = value;

	return (
		typeof id === 'string' &&
		id !== '' &&
		isKind(kind) &&
		typeof base === 'string' &&
		typeof parent === 'string' &&
		isPlainObject(data) &&
		isPlainObject(clocks) &&
		Object.values(clocks).every((clock) => isClock(clock)) &&
		Object.keys(data).every((key) => key in clocks)
	);
}
