import type { Clock } from './clock.ts';
import { isClock } from './clock.ts';

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
	'number',
	'date',
	'choice',
	'check',
	'link',
	'formula'
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export const VIEW_TYPES = ['grid', 'entry', 'list', 'chart'] as const;

export type ViewType = (typeof VIEW_TYPES)[number];

export type Choice = { name: string; color: string | null };

export type BaseDef = { id: string; name: string; order: number };

export type TableDef = { id: string; base: string; name: string; order: number };

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
	step: number | null;
};

export type GridConfig = {
	hidden?: string[];
	sort?: { field: string; dir: 'asc' | 'desc' } | null;
	filter?: { field: string; text: string } | null;
	widths?: Record<string, number>;
};

export type EntryConfig = { fields?: string[]; match?: string[] };

export type ListConfig = { group?: string | null; title?: string | null; show?: string[] };

export type ChartConfig = {
	kind?: 'bar' | 'line';
	x?: string | null;
	bucket?: 'day' | 'week' | 'month' | null;
	agg?: 'count' | 'sum' | 'avg' | 'max' | 'min';
	y?: string | null;
	color?: string | null;
	rolling?: number | null;
};

export type ViewConfig = GridConfig & EntryConfig & ListConfig & ChartConfig;

export type ViewDef = {
	id: string;
	base: string;
	table: string;
	name: string;
	type: ViewType;
	order: number;
	config: ViewConfig;
};

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
