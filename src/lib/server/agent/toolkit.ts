import { canFill, promptToStored } from '../../core/autofill.ts';
import { z } from 'zod';

import { assistant as words } from '../../i18n/assistant.ts';
import fieldCatalog, {
	fields as fieldWords,
	formulaProblem as formulaText
} from '../../i18n/fields.ts';
import { names } from '../../i18n/names.ts';

import type { Actor } from '../../core/access.ts';
import { PATH, hasPath, lockedKeys } from '../../core/access.ts';
import type { FieldSpec } from '../../core/actions.ts';
import {
	addField,
	createBase,
	createTable,
	defaultViews,
	createView,
	deleteRecords,
	homeBase,
	insertRows,
	reorder,
	shifted,
	updateRecord,
	updateRow
} from '../../core/actions.ts';
import { restoreChanges } from '../../core/backup.ts';
import { appendRows, guessColumns, guessTargets, importTable } from '../../core/csv.ts';
import {
	duplicateField,
	duplicateRows,
	duplicateTable,
	duplicateView
} from '../../core/duplicate.ts';
import { sameValue } from '../../core/entry.ts';
import {
	BARE_AGGREGATE,
	FormulaError,
	namesIn,
	scopeOf,
	toDisplay,
	toStored
} from '../../core/formula.ts';
import type {
	Change,
	Choice,
	FieldDef,
	FormatKey,
	Rec,
	TableDef,
	Value,
	ViewConfig,
	ViewDef
} from '../../core/model.ts';
import {
	CREATED,
	DATE_STYLES,
	DELETED,
	FIELD_TYPES,
	FORMAT_OF,
	RESULT_TYPES,
	VIEW_TYPES,
	hasChoices,
	sortsOf
} from '../../core/model.ts';
import { nameTaken, numberedName, sameName } from '../../core/names.ts';
import type { ImageRef } from '../../core/images.ts';
import { MAX_IMAGES, imageRef, imagesValue, isImageId, isImageSource } from '../../core/images.ts';
import { imageLinksOf, retypeField } from '../../core/retype.ts';
import { sourceMark } from '../../core/source.ts';
import type { SqlValue } from '../../core/sql.ts';
import { coerce, parseCheck, ratingScale } from '../../core/values.ts';
import type { Effect } from '../../core/thread.ts';
import type { Workspace } from '../../core/workspace.ts';
import { DATA_COLORS, isDataColor, nextChoice } from '../../ui/colors.ts';
import type { ImageHost } from '../images/host.ts';
import type { IngestProblem } from '../images/ingest.ts';
import { IngestFailed, ingestAll } from '../images/ingest.ts';
import type { SqlResult, SqlTask } from '../sql/jobs.ts';
import { SQL_LIMITS, SqlRefusal, sqlPool } from '../sql/pool.ts';
import type { Sheet } from './files.ts';
import type { SourceHost } from './source-tools.ts';
import { sourceTools } from './source-tools.ts';

// `applied`: the server already wrote these changes (a linked table); the action only shows and undoes them.
export type Action = { summary: string; changes: Change[]; applied?: boolean };

export type ToolContext = {
	ws: Workspace;
	actor: Actor;
	commit(action: Action): void;
	// What the app shows for the person; absent where there is no screen, as over MCP.
	show?(effect: Effect): void;
	sheet?(file: string): Sheet | null;
	sources?: SourceHost;
	images?: ImageHost;
};

// `screen` tools act on what the person sees, `write` tools change records.
export type ToolKind = 'read' | 'write' | 'screen';

export type ToolResult = Record<string, unknown>;

export type Tool = {
	name: string;
	title: string;
	description: string;
	input: z.ZodObject;
	output: z.ZodObject;
	kind: ToolKind;
	/** It may overwrite or remove what is there, rather than only add. */
	destructive: boolean;
	/** A second call with the same input changes nothing more. */
	idempotent: boolean;
	/** It reaches beyond the person's data, to a link on the web. */
	openWorld?: boolean;
	run(ctx: ToolContext, input: never): Promise<ToolResult> | ToolResult;
};

export class ToolError extends Error {
	public constructor(message: string) {
		super(message);
		this.name = 'ToolError';
	}
}

const TITLES = {
	list_bases: 'List bases',
	describe_base: 'Read the schema',
	query: 'Read with SQL',
	add_rows: 'Add rows',
	update_rows: 'Change rows',
	delete_rows: 'Delete rows',
	create_base: 'Create a base',
	create_table: 'Create a table',
	add_field: 'Add a field',
	update_field: 'Change a field',
	create_view: 'Create a view',
	update_view: 'Change a view',
	rename: 'Rename a base, table or view',
	duplicate: 'Duplicate a table, field, view or rows',
	delete: 'Delete a base, table, field or view',
	import_file: 'Import a file',
	open: 'Open a table or page',
	export: 'Download a backup',
	export_table: 'Download a table as CSV',
	move: 'Move a field or view'
};

const LISTED = 30;

function listed(candidates: readonly { name: string }[]): string {
	const shown = candidates.slice(0, LISTED).map((candidate) => JSON.stringify(candidate.name));
	return `${shown.join(', ')}${candidates.length > LISTED ? ', …' : ''}`;
}

function resolve<T extends { id: string; name: string }>(
	candidates: readonly T[],
	ref: string,
	kind: string,
	where: string
): T {
	const byId = candidates.find((candidate) => candidate.id === ref);
	if (byId !== undefined) {
		return byId;
	}
	const named = candidates.filter((candidate) => sameName(candidate.name, ref));
	if (named.length === 1) {
		return named[0];
	}
	const scope = where === '' ? '' : ` ${where}`;
	const missing = `${kind} "${ref}"${scope}`;
	if (named.length > 1) {
		throw new ToolError(
			`"${ref}" names ${named.length} ${kind}s${scope}: ${named.map((candidate) => candidate.id).join(', ')}; give the id`
		);
	}
	if (candidates.length === 0) {
		throw new ToolError(`no ${missing}: there is none`);
	}
	throw new ToolError(`no ${missing}; the ${kind}s are ${listed(candidates)}`);
}

function givenName(name: string, kind: string): string {
	const trimmed = name.trim();
	if (trimmed === '') {
		throw new ToolError(`a ${kind} needs a name`);
	}
	return trimmed;
}

function freeName(
	taken: readonly { id: string; name: string }[],
	name: string,
	kind: string,
	where: string,
	self?: string
): string {
	const trimmed = givenName(name, kind);
	const holder = nameTaken(taken, trimmed, self);
	if (holder !== undefined) {
		throw new ToolError(
			`${where} already has a ${kind} named "${holder.name}" (${holder.id}); pick another name`
		);
	}
	return trimmed;
}

export function findBase(ws: Workspace, ref: string): { id: string; name: string } {
	return resolve(ws.bases(), ref, 'base', '');
}

export function findTable(ws: Workspace, baseId: string, ref: string): TableDef {
	return resolve(ws.tables(baseId), ref, 'table', `in ${ws.base(baseId)?.name ?? baseId}`);
}

export function findField(ws: Workspace, tableId: string, ref: string): FieldDef {
	return resolve(ws.fields(tableId), ref, 'field', `in ${ws.table(tableId)?.name ?? tableId}`);
}

function findView(ws: Workspace, table: TableDef, ref: string): ViewDef {
	return resolve(ws.views(table.id), ref, 'view', `on ${table.name}`);
}

type ChoiceInput = string | { name: string; color: (typeof DATA_COLORS)[number] };

/** A choice keeps its colour unless one is given; a new one without takes the next. */
function choicesOf(given: ChoiceInput[] | undefined, previous: Choice[] = []): Choice[] {
	const choices: Choice[] = [];
	for (const item of given ?? []) {
		const name = typeof item === 'string' ? item : item.name;
		if (choices.some((choice) => choice.name === name)) {
			throw new ToolError(`the choice "${name}" is given twice`);
		}
		const kept = previous.find((choice) => choice.name === name) ?? nextChoice(choices, name);
		choices.push(typeof item === 'string' ? kept : { name, color: item.color });
	}
	return choices;
}

function storedFormula(
	ws: Workspace,
	tableId: string,
	formula: string,
	without: string | null = null
): string {
	try {
		return toStored(formula, scopeOf(ws, tableId, without));
	} catch (error) {
		// The model reads English.
		throw new ToolError(
			error instanceof FormulaError ? formulaText(fieldCatalog.en, error) : String(error)
		);
	}
}

const QUERY_MS = SQL_LIMITS.ms;

function sqlRefusal(message: string): string {
	if (message === 'interrupted') {
		return `the query ran past ${QUERY_MS} ms; aggregate, filter or read fewer rows`;
	}
	return message === 'failed' ? 'the query failed on the server' : message;
}

function formulaRefusal(message: string): string {
	if (message === BARE_AGGREGATE) {
		return fieldCatalog.en.columnTotal;
	}
	if (message === 'interrupted') {
		return `the formula ran past ${QUERY_MS} ms over this table's rows; simplify it`;
	}
	return message === 'failed'
		? 'the formula check failed on the server'
		: `SQLite refuses the formula: ${message}`;
}

function baseRecords(ws: Workspace, baseId: string): Rec[] {
	return [...ws.records.values()].filter((rec) => rec.base === baseId);
}

async function inWorker<K extends SqlTask['kind']>(
	ws: Workspace,
	baseId: string,
	task: Extract<SqlTask, { kind: K }>,
	refusal: (message: string) => string
): Promise<SqlResult[K]> {
	try {
		return await sqlPool.run(baseRecords(ws, baseId), baseId, task);
	} catch (error) {
		throw error instanceof SqlRefusal ? new ToolError(refusal(error.message)) : error;
	}
}

async function frozenValues(
	ws: Workspace,
	baseId: string,
	tableId: string,
	stored: string
): Promise<Map<string, SqlValue>> {
	return new Map(
		await inWorker(ws, baseId, { kind: 'formula-values', table: tableId, stored }, formulaRefusal)
	);
}

async function validateFormula(ws: Workspace, tableId: string, stored: string): Promise<void> {
	const table = ws.table(tableId);
	if (table === undefined) {
		return;
	}
	const problem = await inWorker(
		ws,
		table.base,
		{ kind: 'formula-problem', table: tableId, stored },
		formulaRefusal
	);
	if (problem !== null) {
		throw new ToolError(formulaRefusal(problem));
	}
}

const BASE = z.string().describe('name or id of the base');
const TABLE = z.string().describe('name or id of the table');
const CELL = z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())], {
	error: (issue) =>
		`${JSON.stringify(issue.input)} is not a value: give text, a number, a boolean, null, or an array of texts`
});
export const ROW_VALUES = z
	.record(z.string(), CELL)
	.describe(
		'values by field name: text; a number (an amount for currency, points for percent: 25 for 25%, a score on the scale for rating); "h:mm:ss" or seconds for a duration; a YYYY-MM-DD date, YYYY-MM-DDTHH:MM for a datetime; a boolean for a check; the choice text; an array of choice texts for choices; the main text of the linked row; a URL, email or phone as text; for an image, a link to it, an attached file\'s id or a stored image\'s id, or an array of them'
	);

const FORMAT = {
	decimals: z
		.number()
		.int()
		.min(0)
		.max(6)
		.optional()
		.describe(
			'number, currency, percent, and a formula shown as one: the decimals shown; leave out for automatic'
		),
	grouping: z
		.boolean()
		.optional()
		.describe('number: false for a year, an ID or a code, so 12345 never reads 12,345'),
	unit: z.string().optional().describe('number: shown after it, such as kg or km'),
	currency: z
		.string()
		.regex(/^[A-Z]{3}$/u)
		.optional()
		.describe('currency, and a formula shown as currency: the ISO code, such as EUR or USD'),
	dateStyle: z
		.enum(DATE_STYLES)
		.optional()
		.describe(
			'date, datetime, and a formula shown as a date: short reads "28 Dec" (with the year when not this one), numeric "12/28/2026" in the reader\'s order, weekday "Mon, Dec 28", long "December 28, 2026", iso "2026-12-28"; short when left out'
		),
	result: z
		.enum(RESULT_TYPES)
		.optional()
		.describe(
			'formula: how its result reads; percent reads the result as points, 25 for 25%; automatic when left out'
		),
	min: z.number().int().min(0).max(1).optional().describe('rating: the lowest score, 0 or 1'),
	max: z
		.number()
		.int()
		.min(2)
		.max(10)
		.optional()
		.describe('rating: the highest score, 5 when left out'),
	step: z
		.number()
		.positive()
		.optional()
		.describe("number: the step of the entry form's plus and minus; rating: 0.5 for half points"),
	seconds: z.boolean().optional().describe('duration: shown as h:mm:ss rather than h:mm')
};

type FormatInput = { [key in FormatKey]?: FieldDef[key] };

/** The format keys given for this type, with what the field had for the rest. */
function formatOf(type: FieldDef['type'], input: FormatInput, field?: FieldDef): FormatInput {
	const out: Record<string, unknown> = {};
	for (const key of FORMAT_OF[type]) {
		out[key] = input[key] ?? (field?.type === type ? field[key] : undefined);
	}
	return out as FormatInput;
}

const TYPE = z
	.enum(FIELD_TYPES)
	.describe(
		'text; longtext for notes over several lines; number for counts, measures and years (a year without grouping); currency for money; percent; rating for a score on a scale, such as stars or out of 10; duration for a length of time; date; datetime when the time of day matters; choice for one label out of a few; choices for several labels, such as tags; check for yes or no; link to a row of another table; url; email; phone; formula for a computed value'
	);

const CHOICES = z
	.array(
		z.union([z.string(), z.strictObject({ name: z.string().min(1), color: z.enum(DATA_COLORS) })])
	)
	.describe(
		`for a choice or choices field, in order: a name, or {name, color} to set its colour (${DATA_COLORS.join(', ')}); a name alone keeps the colour it has, a new one takes the next`
	);

const FIELD = z.strictObject({
	name: z.string().min(1),
	type: TYPE,
	...FORMAT,
	choices: CHOICES.optional(),
	target: z.string().optional().describe('for a link field: the linked table'),
	formula: z
		.string()
		.optional()
		.describe(
			'for a formula field: an SQLite expression over the fields of the row, names in double quotes, such as "Weight" * (1 + "Reps" / 30.0). Divide by 30.0 rather than 30: SQLite divides integers as integers. An aggregate needs OVER, such as SUM("Weight") OVER () for the column total on every row. Sheets names work too: IF, IFS, IFERROR, LEFT, RIGHT, MID, LEN, CONCATENATE, TEXTJOIN, SUBSTITUTE, PROPER, FIND, SEARCH, REGEXMATCH, REGEXEXTRACT, REGEXREPLACE, TODAY(), NOW(), YEAR, MONTH, DAY, WEEKDAY, ISOWEEKNUM, DAYS, DATEDIF, EDATE, EOMONTH, NETWORKDAYS, INT, ROUNDUP, ROUNDDOWN, AVERAGE, COUNTA, COUNTUNIQUE, COUNTIF, SUMIF, AVERAGEIF; dates are YYYY-MM-DD text, so DAYS(TODAY(), "Date") counts days where TODAY() - "Date" does not. "Link"."Field" reads a field of the row a link field points to. An aggregate over a table that links here folds its linked rows: SUM("Sets"."Weight" * "Sets"."Reps"), COUNT("Sets"); it needs that table to link here through one field. A name is the row\'s own field first, then a linking table.'
		),
	description: z.string().optional().describe('one sentence saying what the field holds')
});

type FieldInput = z.infer<typeof FIELD>;

function fillSet(
	ws: Workspace,
	field: FieldDef,
	type: FieldDef['type'],
	fill: { prompt: string; web?: boolean; new_rows?: boolean } | null
): Value {
	if (fill === null) return null;
	if (!canFill(type)) throw new ToolError(`a ${type} field can't be filled by AI`);
	const fields = ws.fields(field.table);
	const prompt = promptToStored(fill.prompt.trim(), fields);
	const unknown = [...prompt.replace(/\{\{[a-z]_[a-z0-9]+\}\}/gu, '').matchAll(/\{([^{}]+)\}/gu)];
	if (unknown.length > 0) {
		throw new ToolError(
			`no field named ${unknown.map((match) => `"${match[1]}"`).join(', ')}; the fields are ${fields.map((other) => `"${other.name}"`).join(', ')}`
		);
	}
	const auto = fill.new_rows === true;
	return { prompt, web: fill.web === true, auto, since: auto ? Date.now() : 0 };
}

function fieldSpec(ws: Workspace, baseId: string, input: FieldInput, tableId?: string): FieldSpec {
	const spec: FieldSpec = {
		name: input.name,
		type: input.type,
		description: input.description ?? null,
		...formatOf(input.type, input)
	};

	if (hasChoices(input.type)) {
		spec.choices = choicesOf(input.choices);
	}
	if (input.type === 'link') {
		if (input.target === undefined) {
			throw new ToolError('a link field needs target');
		}
		spec.target = findTable(ws, baseId, input.target).id;
	}
	if (input.type === 'formula') {
		if (input.formula === undefined || tableId === undefined) {
			throw new ToolError('a formula field needs formula');
		}
		spec.expr = storedFormula(ws, tableId, input.formula);
	}

	return spec;
}

// A described null keeps the two branches apart: `type: ["string", "null"]` is less portable.
function fieldOrNull(cleared: string) {
	return z.union([z.string(), z.null().describe(`clears it: ${cleared}`)]);
}

const VIEW_CONFIG = z
	.strictObject({
		hidden: z.array(z.string()).optional().describe('grid: hidden fields'),
		sort: z
			.array(z.strictObject({ field: z.string(), dir: z.enum(['asc', 'desc']) }))
			.nullable()
			.optional()
			.describe(
				'grid: the sort keys in order, each next one breaking the ties of the ones before, such as [{"field": "Date", "dir": "desc"}, {"field": "Set", "dir": "asc"}]'
			),
		filter: z
			.strictObject({ field: z.string(), text: z.string() })
			.nullable()
			.optional()
			.describe('grid: rows whose field contains the text; null clears it'),
		fields: z.array(z.string()).optional().describe('entry: the fields to fill, in order'),
		match: z
			.array(z.string())
			.optional()
			.describe(
				'entry: the fields that identify "last time" for prefilling, in order, such as ["Exercise"]; with two or more, the first repeats its last occurrence row by row, such as ["Session", "Exercise"]'
			),
		group: fieldOrNull('no groups').optional().describe('list: the field to group by'),
		title: fieldOrNull('the first text field')
			.optional()
			.describe('list: the field shown as the title'),
		show: z.array(z.string()).optional().describe('list: the fields shown under the title'),
		kind: z.enum(['bar', 'line']).optional().describe('chart'),
		x: fieldOrNull('no x').optional().describe('chart: the x field, often a date'),
		bucket: z
			.enum(['day', 'week', 'month'])
			.nullable()
			.optional()
			.describe('chart: how dates are grouped'),
		agg: z.enum(['count', 'sum', 'avg', 'max', 'min']).optional().describe('chart'),
		y: fieldOrNull('no y').optional().describe('chart: the aggregated field, except for count'),
		color: fieldOrNull('one series')
			.optional()
			.describe('chart: a choice field that splits the series'),
		rolling: z
			.number()
			.int()
			.min(2)
			.max(90)
			.nullable()
			.optional()
			.describe('line chart: rolling average over N days; null for none')
	})
	.describe('the view settings, fields given by name; null clears a setting');

function viewConfig(
	ws: Workspace,
	tableId: string,
	input: z.infer<typeof VIEW_CONFIG>
): ViewConfig {
	const id = (name: string | null | undefined): string | null =>
		name == null ? null : findField(ws, tableId, name).id;
	const ids = (names: string[] | undefined): string[] | undefined =>
		names?.map((name) => findField(ws, tableId, name).id);

	const config: ViewConfig = {};
	if (input.hidden !== undefined) config.hidden = ids(input.hidden);
	if (input.sort !== undefined)
		config.sort =
			input.sort === null
				? null
				: input.sort.map((key) => ({ field: findField(ws, tableId, key.field).id, dir: key.dir }));
	if (input.filter !== undefined)
		config.filter =
			input.filter === null
				? null
				: { field: findField(ws, tableId, input.filter.field).id, text: input.filter.text };
	if (input.fields !== undefined) config.fields = ids(input.fields);
	if (input.match !== undefined) config.match = ids(input.match);
	if (input.group !== undefined) config.group = id(input.group);
	if (input.title !== undefined) config.title = id(input.title);
	if (input.show !== undefined) config.show = ids(input.show);
	if (input.kind !== undefined) config.kind = input.kind;
	if (input.x !== undefined) config.x = id(input.x);
	if (input.bucket !== undefined) config.bucket = input.bucket;
	if (input.agg !== undefined) config.agg = input.agg;
	if (input.y !== undefined) config.y = id(input.y);
	if (input.color !== undefined) config.color = id(input.color);
	if (input.rolling !== undefined) config.rolling = input.rolling;

	return config;
}

function requireRow(ws: Workspace, table: TableDef, id: string): void {
	const rec = ws.live(id);
	if (rec?.kind === 'row' && rec.parent === table.id) {
		return;
	}
	if (rec !== undefined && rec.kind !== 'row') {
		throw new ToolError(
			`${id} is a ${rec.kind}, not a row of ${table.name}; rows are the "_id" column of query`
		);
	}
	throw new ToolError(`no row ${id} in ${table.name}; rows are the "_id" column of query`);
}

function createdAt(rec: Rec | undefined): number | undefined {
	const at = rec?.data[CREATED];
	return typeof at === 'number' ? at : undefined;
}

/** The creation times new rows fit between to sit after or before a row, as the grid's Insert row does. */
function rowSpan(
	ws: Workspace,
	table: TableDef,
	after: string | undefined,
	before: string | undefined
): { from: number; to: number } | null {
	if (after !== undefined && before !== undefined) {
		throw new ToolError('give after or before, not both');
	}
	const anchor = after ?? before;
	if (anchor === undefined) return null;
	requireRow(ws, table, anchor);
	const rows = ws.rows(table.id);
	const index = rows.findIndex((row) => row.id === anchor);
	const here = createdAt(rows[index]) ?? Date.now();
	const next = createdAt(rows[index + (after !== undefined ? 1 : -1)]);
	const other = next ?? here + (after !== undefined ? 1 : -1);
	return after !== undefined ? { from: here, to: other } : { from: other, to: here };
}

function expected(field: FieldDef): string {
	switch (field.type) {
		case 'number':
			return 'a number';
		case 'currency':
			return 'an amount';
		case 'percent':
			return 'a percent (25 for 25%)';
		case 'rating': {
			const scale = ratingScale(field);
			return `a rating from ${scale.min} to ${scale.max}${scale.step === 1 ? '' : ' by halves'}`;
		}
		case 'duration':
			return 'a duration (h:mm:ss, or seconds)';
		case 'date':
			return 'a date (YYYY-MM-DD)';
		case 'datetime':
			return 'a date and time (YYYY-MM-DDTHH:MM)';
		case 'check':
			return 'a check (true or false)';
		case 'choice':
			return 'a choice (its text)';
		case 'choices':
			return 'choices (an array of their texts)';
		case 'link':
			return 'a link (the main text or the _id of a row)';
		case 'url':
			return 'a URL';
		case 'email':
			return 'an email address';
		case 'phone':
			return 'a phone number';
		case 'image':
			return 'an image: a link to one, an attached file\'s id, a stored image\'s id, or an array of them';
		case 'text':
		case 'longtext':
		case 'formula':
			return 'text';
	}
}

function blank(value: unknown): boolean {
	return (
		value === undefined ||
		value === null ||
		(typeof value === 'string' && value.trim() === '') ||
		(Array.isArray(value) && value.length === 0)
	);
}

function readable(field: FieldDef, value: unknown): boolean {
	if (field.type === 'check' && typeof value === 'string') {
		return parseCheck(value) !== null;
	}
	if (field.type === 'link') {
		return typeof value === 'string';
	}
	if (field.type === 'choices' && Array.isArray(value)) {
		return value.every((name) => typeof name === 'string' || typeof name === 'number');
	}
	return coerce(field, value) !== null;
}

function linkValue(ws: Workspace, field: FieldDef, value: unknown): unknown {
	if (field.type !== 'link' || field.target === null || typeof value !== 'string') {
		return value;
	}
	const target = field.target;
	if (ws.live(value)?.kind === 'row' && ws.live(value)?.parent === target) {
		return value;
	}

	const primary = ws.fields(target).find((candidate) => candidate.type === 'text');
	const matches = ws
		.rows(target)
		.filter(
			(row) =>
				primary !== undefined &&
				typeof row.data[primary.id] === 'string' &&
				sameName(String(row.data[primary.id]), value)
		);
	const table = ws.table(target)?.name ?? target;

	if (matches.length === 0) {
		throw new ToolError(`no row "${value}" in ${table}, which "${field.name}" links to`);
	}
	if (matches.length > 1) {
		throw new ToolError(
			`${matches.length} rows of ${table} read "${value}" (${matches.map((row) => row.id).join(', ')}); give the _id`
		);
	}
	return matches[0].id;
}

// Fetching stores bytes, whatever the call ends with: a call fetches this many links at most.
const MAX_FETCHES = 50;

// A retype fetches every link of a column, within the account's fetch budget.
const MAX_RETYPE_FETCHES = 300;

const FETCH_PROBLEMS: Record<IngestProblem, string> = {
	scheme: 'only http and https links are fetched',
	address: 'it points to a private address',
	timeout: 'it took too long to answer',
	network: 'it could not be reached',
	status: 'it answered with an error',
	size: 'it is over 10 MB',
	'not-an-image': 'it is not a JPEG, PNG, WebP, GIF or AVIF image',
	'too-many-pixels': 'it has over 40 million pixels',
	full: 'the account\'s image storage is full',
	busy: 'too many images were fetched this minute; try again in a minute'
};

function imageHostOf(ctx: ToolContext): ImageHost {
	if (ctx.images === undefined) {
		throw new ToolError('images cannot be added from here');
	}
	return ctx.images;
}

/** Links, attached files and stored ids given for image fields, as the images they name; any one that fails refuses the call. */
async function storedImages(
	ctx: ToolContext,
	baseId: string,
	tableId: string,
	rows: Record<string, unknown>[],
	where: (index: number) => string
): Promise<Record<string, unknown>[]> {
	type Item = { at: string; given: string; ref: ImageRef | null };
	const wanted: { row: number; field: string; items: Item[] }[] = [];
	for (const [index, values] of rows.entries()) {
		for (const [name, value] of Object.entries(values)) {
			const field = findField(ctx.ws, tableId, name);
			if (field.type !== 'image' || blank(value)) continue;
			const at = `${where(index)}.${JSON.stringify(field.name)}`;
			const given = (Array.isArray(value) ? value : [value]).filter((item) => !blank(item));
			if (given.length > MAX_IMAGES) {
				throw new ToolError(`${at}: a cell holds up to ${MAX_IMAGES} images; nothing was written`);
			}
			const host = imageHostOf(ctx);
			const items = given.map((item): Item => {
				const ref = imageRef(item);
				if (ref !== null) return { at, given: ref.id, ref };
				if (typeof item !== 'string') {
					throw new ToolError(`${at}: ${JSON.stringify(item)} is not ${expected(field)}; nothing was written`);
				}
				const text = item.trim();
				const stored = isImageId(text) ? host.fromId(baseId, text) : null;
				const attached = stored ?? host.fromFile(baseId, text);
				if (attached !== null) return { at, given: text, ref: attached };
				if (!isImageSource(text)) {
					throw new ToolError(`${at}: ${JSON.stringify(item)} is not ${expected(field)}; nothing was written`);
				}
				return { at, given: text, ref: null };
			});
			wanted.push({ row: index, field: name, items });
		}
	}

	const links = [...new Set(wanted.flatMap(({ items }) => items.filter((item) => item.ref === null).map((item) => item.given)))];
	if (links.length > MAX_FETCHES) {
		throw new ToolError(`a call fetches up to ${MAX_FETCHES} image links; split the rest into further calls`);
	}
	const host = links.length === 0 ? null : imageHostOf(ctx);
	const fetched = host === null ? new Map() : await ingestAll(links, (url) => host.fromUrl(baseId, url));

	const out = rows.map((values) => ({ ...values }));
	for (const { row, field, items } of wanted) {
		const refs = items.map((item) => {
			const got = item.ref ?? fetched.get(item.given);
			if (got instanceof IngestFailed || got === undefined) {
				const why = got instanceof IngestFailed ? FETCH_PROBLEMS[got.problem] : 'it could not be fetched';
				throw new ToolError(`${item.at}: ${item.given} was not stored: ${why}; nothing was written`);
			}
			return got;
		});
		out[row][field] = imagesValue(refs);
	}
	return out;
}

/** Field names to ids, link texts to row ids, unseen choices added to their field. */
function rowsByName(
	ws: Workspace,
	tableId: string,
	rows: Record<string, unknown>[],
	where: (index: number) => string
): { rows: Record<string, unknown>[]; fieldChanges: Change[] } {
	const fields = ws.fields(tableId);
	const added = new Map<string, Set<string>>();

	const out = rows.map((values, index) => {
		const row: Record<string, unknown> = {};
		for (const [name, value] of Object.entries(values)) {
			const field = findField(ws, tableId, name);
			if (field.type === 'formula') {
				throw new ToolError(
					`${where(index)}.${JSON.stringify(field.name)}: a formula computes its value; leave it out`
				);
			}
			if (!blank(value) && !readable(field, value)) {
				throw new ToolError(
					`${where(index)}.${JSON.stringify(field.name)}: ${JSON.stringify(value)} is not ${expected(field)}; nothing was written`
				);
			}
			const picked = hasChoices(field.type) ? coerce(field, value) : null;
			for (const name of Array.isArray(picked) ? picked : picked === null ? [] : [picked]) {
				if (typeof name === 'string' && !field.choices.some((choice) => choice.name === name)) {
					let names = added.get(field.id);
					if (names === undefined) {
						names = new Set();
						added.set(field.id, names);
					}
					names.add(name);
				}
			}
			row[field.id] = linkValue(ws, field, value);
		}
		return row;
	});

	const fieldChanges = [...added].flatMap(([fieldId, names]) => {
		const field = fields.find((candidate) => candidate.id === fieldId) as FieldDef;
		const choices = [...field.choices];
		for (const name of names) {
			choices.push(nextChoice(choices, name));
		}
		return updateRecord(ws, fieldId, { choices });
	});

	return { rows: out, fieldChanges };
}

const FIELD_OUT = z.strictObject({
	id: z.string(),
	name: z.string(),
	type: z.enum(FIELD_TYPES),
	decimals: z.number().optional(),
	grouping: z.boolean().optional(),
	unit: z.string().optional(),
	currency: z.string().optional(),
	min: z.number().optional(),
	max: z.number().optional(),
	step: z.number().optional(),
	seconds: z.boolean().optional(),
	dateStyle: z.enum(DATE_STYLES).optional(),
	result: z.enum(RESULT_TYPES).optional(),
	choices: z
		.array(z.strictObject({ name: z.string(), color: z.enum(DATA_COLORS).nullable() }))
		.optional(),
	target: z.string().optional(),
	formula: z.string().optional(),
	description: z.string().optional(),
	from: z.string().optional().describe('the path its source fills it from: read-only')
});

function describeField(ws: Workspace, field: FieldDef): z.infer<typeof FIELD_OUT> {
	const out: Record<string, unknown> = { id: field.id, name: field.name, type: field.type };

	for (const key of FORMAT_OF[field.type]) {
		if (field[key] !== null && !(key === 'grouping' && field[key])) out[key] = field[key];
	}
	if (hasChoices(field.type))
		out.choices = field.choices.map((choice) => ({
			name: choice.name,
			color: isDataColor(choice.color) ? choice.color : null
		}));
	const target =
		field.type === 'link' && field.target !== null ? ws.table(field.target) : undefined;
	if (target !== undefined) out.target = target.name;
	if (field.type === 'formula' && field.expr !== null)
		out.formula = toDisplay(field.expr, namesIn(ws, field.base));
	if (field.description !== null) out.description = field.description;
	const from = ws.get(field.id)?.data[PATH];
	if (typeof from === 'string' && from !== '') out.from = from;

	return out as z.infer<typeof FIELD_OUT>;
}

const VIEW_OUT = z.strictObject({
	id: z.string(),
	name: z.string(),
	type: z.enum(VIEW_TYPES),
	config: z.strictObject({
		hidden: z.array(z.string()).optional(),
		sort: z
			.array(z.strictObject({ field: z.string(), dir: z.enum(['asc', 'desc']) }))
			.nullable()
			.optional(),
		filter: z.strictObject({ field: z.string(), text: z.string() }).nullable().optional(),
		fields: z.array(z.string()).optional(),
		match: z.array(z.string()).optional(),
		group: fieldOrNull('no groups').optional(),
		title: z.string().optional(),
		show: z.array(z.string()).optional(),
		kind: z.enum(['bar', 'line']).optional(),
		x: z.string().optional(),
		bucket: z.enum(['day', 'week', 'month']).nullable().optional(),
		agg: z.enum(['count', 'sum', 'avg', 'max', 'min']).optional(),
		y: z.string().optional(),
		color: z.string().optional(),
		rolling: z.number().optional()
	})
});

export function describeView(ws: Workspace, view: ViewDef): z.infer<typeof VIEW_OUT> {
	const { config } = view;
	const name = (id: string): string => ws.field(id)?.name ?? id;
	const out: z.infer<typeof VIEW_OUT>['config'] = {};

	for (const key of ['hidden', 'fields', 'match', 'show'] as const) {
		const ids = config[key];
		if (ids !== undefined) out[key] = ids.map(name);
	}
	for (const key of ['group', 'title', 'x', 'y', 'color'] as const) {
		const id = config[key];
		if (typeof id === 'string') out[key] = name(id);
	}
	// A list with no groups chose it; one with no setting groups on its own.
	if (config.group === null) out.group = null;
	if (config.sort !== undefined)
		out.sort =
			config.sort === null
				? null
				: sortsOf(config).map((key) => ({ ...key, field: name(key.field) }));
	if (config.filter !== undefined)
		out.filter =
			config.filter === null ? null : { ...config.filter, field: name(config.filter.field) };
	if (config.kind !== undefined) out.kind = config.kind;
	if (config.bucket !== undefined) out.bucket = config.bucket;
	if (config.agg !== undefined) out.agg = config.agg;
	if (typeof config.rolling === 'number') out.rolling = config.rolling;

	return { id: view.id, name: view.name, type: view.type, config: out };
}

function sourceOf(ws: Workspace, tableId: string): { source?: string } {
	const mark = sourceMark(ws.get(tableId));
	return mark === null ? {} : { source: mark.name };
}

const ID = z.strictObject({ id: z.string() });

export const TOOLS: Tool[] = [
	{
		name: 'list_bases',
		title: TITLES.list_bases,
		description: 'The bases of the person, with their tables and the row count of each table.',
		input: z.strictObject({}),
		output: z.strictObject({
			bases: z.array(
				z.strictObject({
					id: z.string(),
					name: z.string(),
					tables: z.array(z.strictObject({ id: z.string(), name: z.string(), rows: z.number() }))
				})
			)
		}),
		kind: 'read',
		destructive: false,
		idempotent: true,
		run: ({ ws }) => ({
			bases: ws.bases().map((base) => ({
				id: base.id,
				name: base.name,
				tables: ws
					.tables(base.id)
					.map((table) => ({ id: table.id, name: table.name, rows: ws.rows(table.id).length }))
			}))
		})
	},
	{
		name: 'describe_base',
		title: TITLES.describe_base,
		description:
			'The schema of a base: its tables, their fields (type, choices, formula, description) and their views.',
		input: z.strictObject({ base: BASE }),
		output: z.strictObject({
			id: z.string(),
			name: z.string(),
			tables: z.array(
				z.strictObject({
					id: z.string(),
					name: z.string(),
					rows: z.number(),
					source: z
						.string()
						.optional()
						.describe(
							'what fills the table: its rows come from there, never added or deleted here'
						),
					fields: z.array(FIELD_OUT),
					views: z.array(VIEW_OUT)
				})
			)
		}),
		kind: 'read',
		destructive: false,
		idempotent: true,
		run: ({ ws }, { base }: { base: string }) => {
			const found = findBase(ws, base);
			return {
				id: found.id,
				name: found.name,
				tables: ws.tables(found.id).map((table) => ({
					id: table.id,
					name: table.name,
					rows: ws.rows(table.id).length,
					...sourceOf(ws, table.id),
					fields: ws.fields(table.id).map((field) => describeField(ws, field)),
					views: ws.views(table.id).map((view) => describeView(ws, view))
				}))
			};
		}
	},
	{
		name: 'query',
		title: TITLES.query,
		description: `A read-only SQLite SELECT on a base. Each table is a view named like the table, its columns named like its fields: select "Exercise", max("Weight") from "Sets" group by 1. The columns "_id" and "_created" (ms) exist too. Dates are YYYY-MM-DD text (YYYY-MM-DDTHH:MM with a time), checks are 0 or 1, a percent is its points (25 for 25%), a duration is seconds, a choices field is a JSON array of names (read it with json_each), a link reads as the text of the linked row. One page holds at most 200 rows and about 48 KB, text cut at 2,000 characters (cut counts the cells cut); next is the offset of the following page, null on the last. A query stops after ${QUERY_MS} ms: aggregate or filter rather than page through a whole table.`,
		input: z.strictObject({
			base: BASE,
			sql: z.string().min(1),
			offset: z
				.number()
				.int()
				.min(0)
				.optional()
				.describe('the next of the previous page, to read the following one')
		}),
		output: z.strictObject({
			columns: z.array(z.string()),
			rows: z.array(
				z.array(
					z.union([
						z.string().describe('text'),
						z.number().describe('a number'),
						z.null().describe('an empty cell')
					])
				)
			),
			next: z.union([
				z.number().describe('the offset of the following page'),
				z.null().describe('this is the last page')
			]),
			cut: z.number()
		}),
		kind: 'read',
		destructive: false,
		idempotent: true,
		run: ({ ws }, { base, sql, offset }: { base: string; sql: string; offset?: number }) => {
			const found = findBase(ws, base);
			return inWorker(ws, found.id, { kind: 'query', sql, offset: offset ?? 0 }, sqlRefusal);
		}
	},
	{
		name: 'add_rows',
		title: TITLES.add_rows,
		description:
			'Adds rows to a table, last unless placed with after or before. Values are given by field name; a choice not seen before is added to its field. A value the field cannot hold refuses the whole call.',
		input: z.strictObject({
			base: BASE,
			table: TABLE,
			rows: z.array(ROW_VALUES).min(1).max(500),
			after: z.string().optional().describe('the "_id" of the row they go right after'),
			before: z.string().optional().describe('the "_id" of the row they go right before')
		}),
		output: z.strictObject({ added: z.array(z.string()) }),
		kind: 'write',
		destructive: false,
		idempotent: false,
		run: async (
			ctx,
			input: {
				base: string;
				table: string;
				rows: Record<string, unknown>[];
				after?: string;
				before?: string;
			}
		) => {
			const base = findBase(ctx.ws, input.base);
			const table = findTable(ctx.ws, base.id, input.table);
			const span = rowSpan(ctx.ws, table, input.after, input.before);
			const where = (index: number) => `rows[${index}]`;
			const { rows, fieldChanges } = rowsByName(
				ctx.ws,
				table.id,
				await storedImages(ctx, base.id, table.id, input.rows, where),
				where
			);
			const inserted = insertRows(ctx.ws, table.id, rows);
			if (span !== null) {
				const step = (span.to - span.from) / (inserted.ids.length + 1);
				for (const change of inserted.changes) {
					const at = inserted.ids.indexOf(change.id);
					if (at !== -1) change.set[CREATED] = span.from + step * (at + 1);
				}
			}
			ctx.commit({
				summary: words.addRows(rows.length, table.name),
				changes: [...fieldChanges, ...inserted.changes]
			});
			return { added: inserted.ids };
		}
	},
	{
		name: 'update_rows',
		title: TITLES.update_rows,
		description: 'Changes existing rows, named by their "_id". Only the fields given change.',
		kind: 'write',
		destructive: true,
		idempotent: true,
		input: z.strictObject({
			base: BASE,
			table: TABLE,
			updates: z
				.array(z.strictObject({ id: z.string(), values: ROW_VALUES }))
				.min(1)
				.max(500)
		}),
		output: z.strictObject({ updated: z.number() }),
		run: async (
			ctx,
			input: {
				base: string;
				table: string;
				updates: { id: string; values: Record<string, unknown> }[];
			}
		) => {
			const base = findBase(ctx.ws, input.base);
			const table = findTable(ctx.ws, base.id, input.table);
			for (const update of input.updates) {
				requireRow(ctx.ws, table, update.id);
			}
			const where = (index: number) => `updates[${index}].values`;
			const { rows, fieldChanges } = rowsByName(
				ctx.ws,
				table.id,
				await storedImages(
					ctx,
					base.id,
					table.id,
					input.updates.map((update) => update.values),
					where
				),
				where
			);
			const changes = input.updates.flatMap((update, index) =>
				updateRow(ctx.ws, update.id, rows[index])
			);
			ctx.commit({
				summary: words.changeRows(changes.length, table.name),
				changes: [...fieldChanges, ...changes]
			});
			return { updated: changes.length };
		}
	},
	{
		name: 'delete_rows',
		title: TITLES.delete_rows,
		description: 'Deletes rows named by their "_id".',
		input: z.strictObject({
			base: BASE,
			table: TABLE,
			ids: z.array(z.string()).min(1).max(1000)
		}),
		output: z.strictObject({ deleted: z.number() }),
		kind: 'write',
		destructive: true,
		idempotent: true,
		run: (ctx, input: { base: string; table: string; ids: string[] }) => {
			const base = findBase(ctx.ws, input.base);
			const table = findTable(ctx.ws, base.id, input.table);
			const ids = [...new Set(input.ids)];
			for (const id of ids) {
				requireRow(ctx.ws, table, id);
			}
			ctx.commit({
				summary: words.deleteRows(ids.length, table.name),
				changes: deleteRecords(ctx.ws, ids)
			});
			return { deleted: ids.length };
		}
	},
	{
		name: 'create_base',
		title: TITLES.create_base,
		description: 'Creates an empty base, to fill with create_table afterwards.',
		input: z.strictObject({ name: z.string().min(1) }),
		output: ID,
		kind: 'write',
		destructive: false,
		idempotent: false,
		run: (ctx, { name }: { name: string }) => {
			const trimmed = givenName(name, 'base');
			const made = createBase(ctx.ws, trimmed);
			ctx.commit({ summary: words.newBase(trimmed), changes: made.changes });
			return { id: made.id };
		}
	},
	{
		name: 'create_table',
		title: TITLES.create_table,
		description:
			'Creates a table with its fields and its Grid and Entry views. Formulas come afterwards through add_field, once the fields they read are in place. Table names are unique in a base, field names in a table.',
		kind: 'write',
		destructive: false,
		idempotent: false,
		input: z.strictObject({
			base: BASE.optional().describe(
				'name or id of the base; leave it out for the default base, unless the person names one'
			),
			name: z.string().min(1),
			fields: z
				.array(FIELD.omit({ formula: true }).extend({ type: TYPE.exclude(['formula']) }))
				.min(1)
		}),
		output: z.strictObject({ id: z.string(), base: z.string() }),
		run: (ctx, input: { base?: string; name: string; fields: FieldInput[] }) => {
			const base =
				input.base === undefined
					? homeBase(ctx.ws, names)
					: { id: findBase(ctx.ws, input.base).id, changes: [] };
			const where = ctx.ws.base(base.id)?.name ?? base.id;
			const name = freeName(ctx.ws.tables(base.id), input.name, 'table', where);
			const seen: { id: string; name: string }[] = [];
			for (const [index, field] of input.fields.entries()) {
				seen.push({
					id: `fields[${index}]`,
					name: freeName(seen, field.name, 'field', `"${name}"`)
				});
			}
			const specs = input.fields.map((field) => fieldSpec(ctx.ws, base.id, field));
			const made = createTable(ctx.ws, base.id, name, specs, () => defaultViews(names));
			ctx.commit({
				summary: words.newTable(name),
				changes: [...base.changes, ...made.changes]
			});
			return { id: made.id, base: base.id };
		}
	},
	{
		name: 'add_field',
		title: TITLES.add_field,
		description:
			'Adds a field to a table, a computed one (formula) included, last unless a position is given. SQLite checks a formula first. Field names are unique in a table.',
		input: FIELD.extend({
			base: BASE,
			table: TABLE,
			position: z
				.number()
				.int()
				.min(1)
				.optional()
				.describe('where it goes among the fields, 1 for first')
		}),
		output: ID,
		kind: 'write',
		destructive: false,
		idempotent: false,
		run: async (ctx, input: FieldInput & { base: string; table: string; position?: number }) => {
			const base = findBase(ctx.ws, input.base);
			const table = findTable(ctx.ws, base.id, input.table);
			const name = freeName(ctx.ws.fields(table.id), input.name, 'field', table.name);
			const { position, ...field } = input;
			const spec = fieldSpec(ctx.ws, base.id, { ...field, name }, table.id);
			if (spec.expr != null) {
				await validateFormula(ctx.ws, table.id, spec.expr);
			}
			const made = addField(
				ctx.ws,
				table.id,
				spec,
				position === undefined ? undefined : position - 1
			);
			ctx.commit({
				summary: words.newField(name, table.name),
				changes: made.changes
			});
			return { id: made.id };
		}
	},
	{
		name: 'update_field',
		title: TITLES.update_field,
		description:
			'Renames a field, or changes its type, format, choices, formula or description. A new type or scale converts every value; `lost` counts those it cannot hold, now empty. A field becoming image fetches the image each link in its values names.',
		kind: 'write',
		destructive: true,
		idempotent: true,
		input: z.strictObject({
			base: BASE,
			table: TABLE,
			field: z.string().describe('name or id of the field'),
			name: z.string().min(1).optional(),
			type: TYPE.optional(),
			...FORMAT,
			target: z.string().optional().describe('for a field becoming a link: the linked table'),
			choices: CHOICES.optional().describe(
				`every choice, in order: a name, or {name, color} to set its colour (${DATA_COLORS.join(', ')}); a name alone keeps the colour it has; one left out is removed`
			),
			formula: z.string().optional(),
			description: z.string().optional(),
			fill: z
				.strictObject({
					prompt: z
						.string()
						.min(1)
						.describe(
							'what to write for each row, other fields named in braces: IMDb rating of {Title}'
						),
					web: z.boolean().optional().describe('search the web for each value'),
					new_rows: z.boolean().optional().describe('fill rows added from now on, on their own')
				})
				.nullable()
				.optional()
				.describe(
					'have a model fill this field per row from a prompt; the person fills its empty cells from the column menu. null turns it off'
				)
		}),
		output: z.strictObject({ updated: z.string(), lost: z.number() }),
		run: async (
			ctx,
			input: FormatInput & {
				base: string;
				table: string;
				field: string;
				name?: string;
				type?: FieldDef['type'];
				target?: string;
				choices?: ChoiceInput[];
				formula?: string;
				description?: string;
				fill?: { prompt: string; web?: boolean; new_rows?: boolean } | null;
			}
		) => {
			const base = findBase(ctx.ws, input.base);
			const table = findTable(ctx.ws, base.id, input.table);
			const field = findField(ctx.ws, table.id, input.field);
			const type = input.type ?? field.type;
			const set: Record<string, Value> = {};
			if (input.name !== undefined)
				set.name = freeName(ctx.ws.fields(table.id), input.name, 'field', table.name, field.id);
			if (input.description !== undefined) set.description = input.description;
			if (input.fill !== undefined) set.fill = fillSet(ctx.ws, field, type, input.fill);
			let expr: string | null = null;
			if (input.formula !== undefined) {
				if (type !== 'formula') throw new ToolError(`"${field.name}" is not a computed field`);
				expr = storedFormula(ctx.ws, table.id, input.formula, field.id);
				await validateFormula(ctx.ws, table.id, expr);
				set.expr = expr;
			}

			const format = formatOf(type, input, field);
			const reformat = FORMAT_OF[type].some((key) => input[key] !== undefined);
			let converted: { changes: Change[]; lost: number } = { changes: [], lost: 0 };
			if (type !== field.type || reformat) {
				if (type === 'formula' && expr === null && field.type !== 'formula')
					throw new ToolError('a formula field needs formula');
				if (type === 'link' && input.target === undefined && field.type !== 'link')
					throw new ToolError('a link field needs target');
				const computed =
					field.type === 'formula' && field.expr !== null
						? new Map(
								[...(await frozenValues(ctx.ws, base.id, table.id, field.expr))].map(
									([row, value]) => [row, { [field.id]: value }]
								)
							)
						: undefined;
				let fetched: Map<string, ImageRef> | undefined;
				if (type === 'image' && field.type !== 'image') {
					const links = imageLinksOf(ctx.ws, field.id);
					if (links.length > MAX_RETYPE_FETCHES) {
						throw new ToolError(
							`"${field.name}" holds ${links.length} links; a retype to image fetches up to ${MAX_RETYPE_FETCHES}`
						);
					}
					const host = links.length === 0 ? null : imageHostOf(ctx);
					fetched = new Map();
					if (host !== null) {
						for (const [link, got] of await ingestAll(links, (url) => host.fromUrl(base.id, url))) {
							if (!(got instanceof IngestFailed)) fetched.set(link, got);
						}
					}
				}
				converted = retypeField(
					ctx.ws,
					field.id,
					{
						type,
						fetched,
						...format,
						target:
							input.target === undefined
								? field.target
								: findTable(ctx.ws, base.id, input.target).id,
						expr: expr ?? field.expr,
						choices:
							input.choices === undefined ? undefined : choicesOf(input.choices, field.choices),
						checkWords: { yes: fieldWords.yes, no: fieldWords.no }
					},
					computed
				);
			}
			// A retype's own field change already holds the given choices plus those found in values.
			if (input.choices !== undefined && converted.changes.length === 0)
				set.choices = choicesOf(input.choices, field.choices);
			ctx.commit({
				summary: words.changeField(field.name, table.name),
				changes: [...converted.changes, ...updateRecord(ctx.ws, field.id, set)]
			});
			return { updated: field.id, lost: converted.lost };
		}
	},
	{
		name: 'create_view',
		title: TITLES.create_view,
		description:
			'Adds a view to a table: grid (the spreadsheet), entry (fast input on a phone, prefilled from the last row with the same match values), list (grouped cards) or chart (bars or a line of an aggregate).',
		kind: 'write',
		destructive: false,
		idempotent: false,
		input: z.strictObject({
			base: BASE,
			table: TABLE,
			name: z.string().min(1),
			type: z.enum(VIEW_TYPES),
			config: VIEW_CONFIG
		}),
		output: ID,
		run: (
			ctx,
			input: {
				base: string;
				table: string;
				name: string;
				type: (typeof VIEW_TYPES)[number];
				config: z.infer<typeof VIEW_CONFIG>;
			}
		) => {
			const base = findBase(ctx.ws, input.base);
			const table = findTable(ctx.ws, base.id, input.table);
			const name = givenName(input.name, 'view');
			const made = createView(ctx.ws, table.id, {
				name,
				type: input.type,
				config: viewConfig(ctx.ws, table.id, input.config)
			});
			ctx.commit({
				summary: words.newView(name, table.name),
				changes: made.changes
			});
			return { id: made.id };
		}
	},
	{
		name: 'delete',
		title: TITLES.delete,
		description:
			'Deletes a base, table, field or view by its id. A base goes with its tables, a table with its rows.',
		input: z.strictObject({ base: BASE, id: z.string() }),
		output: z.strictObject({ deleted: z.string() }),
		kind: 'write',
		destructive: true,
		idempotent: true,
		run: (ctx, input: { base: string; id: string }) => {
			const base = findBase(ctx.ws, input.base);
			const rec = ctx.ws.live(input.id);
			if (
				rec === undefined ||
				rec.base !== base.id ||
				!['base', 'table', 'field', 'view'].includes(rec.kind)
			) {
				if (rec?.kind === 'row' && rec.base === base.id) {
					throw new ToolError(`${input.id} is a row; delete_rows deletes rows`);
				}
				throw new ToolError(
					`no base, table, field or view ${input.id} in ${base.name}; describe_base gives the ids`
				);
			}
			const name = typeof rec.data.name === 'string' ? rec.data.name : rec.id;
			const summary =
				rec.kind === 'base'
					? words.deleteBase(name)
					: rec.kind === 'table'
						? words.deleteTable(name)
						: rec.kind === 'field'
							? words.deleteField(name)
							: words.deleteView(name);
			ctx.commit({
				summary,
				changes: deleteRecords(ctx.ws, [rec.id])
			});
			return { deleted: rec.id };
		}
	},
	{
		name: 'rename',
		title: TITLES.rename,
		description:
			'Renames a base, a table or a view by its id; update_field renames a field. Table names are unique in a base.',
		input: z.strictObject({ base: BASE, id: z.string(), name: z.string().min(1) }),
		output: z.strictObject({ renamed: z.string() }),
		kind: 'write',
		destructive: true,
		idempotent: true,
		run: (ctx, input: { base: string; id: string; name: string }) => {
			const base = findBase(ctx.ws, input.base);
			const rec = ctx.ws.live(input.id);
			if (rec?.kind === 'field' && rec.base === base.id) {
				throw new ToolError(`${input.id} is a field; update_field renames fields`);
			}
			if (
				rec === undefined ||
				rec.base !== base.id ||
				!['base', 'table', 'view'].includes(rec.kind)
			) {
				throw new ToolError(
					`no base, table or view ${input.id} in ${base.name}; describe_base gives the ids`
				);
			}
			const name =
				rec.kind === 'table'
					? freeName(ctx.ws.tables(base.id), input.name, 'table', base.name, rec.id)
					: givenName(input.name, rec.kind);
			const before = typeof rec.data.name === 'string' ? rec.data.name : rec.id;
			const summary =
				rec.kind === 'base'
					? words.renameBase(before, name)
					: rec.kind === 'table'
						? words.renameTable(before, name)
						: words.renameView(before, name);
			ctx.commit({
				summary,
				changes: updateRecord(ctx.ws, rec.id, { name })
			});
			return { renamed: rec.id };
		}
	},
	{
		name: 'duplicate',
		title: TITLES.duplicate,
		description:
			'Copies a table with its fields, views and rows; or, given field, view or rows, that field with its values, that view with its settings, or those rows, each copy placed right after what it copies.',
		input: z.strictObject({
			base: BASE,
			table: TABLE,
			field: z.string().optional().describe('name or id of the field to copy'),
			view: z.string().optional().describe('name or id of the view to copy'),
			rows: z.array(z.string()).optional().describe('ids of the rows to copy, from _id'),
			name: z
				.string()
				.min(1)
				.optional()
				.describe('the name of a copied table, field or view; "<name> copy" when left out')
		}),
		output: z.strictObject({
			created: z.string().optional(),
			added: z.array(z.string()).optional()
		}),
		kind: 'write',
		destructive: false,
		idempotent: false,
		run: (
			ctx,
			input: {
				base: string;
				table: string;
				field?: string;
				view?: string;
				rows?: string[];
				name?: string;
			}
		) => {
			const base = findBase(ctx.ws, input.base);
			const table = findTable(ctx.ws, base.id, input.table);
			if (input.rows !== undefined) {
				const id = input.rows.find((row) => {
					const rec = ctx.ws.live(row);
					return rec?.kind !== 'row' || rec.parent !== table.id;
				});
				if (id !== undefined) throw new ToolError(`no row ${id} in ${table.name}`);
				const made = duplicateRows(ctx.ws, table.id, input.rows);
				ctx.commit({ summary: words.addRows(made.ids.length, table.name), changes: made.changes });
				return { added: made.ids };
			}
			if (input.field !== undefined) {
				const field = findField(ctx.ws, table.id, input.field);
				const fields = ctx.ws.fields(table.id);
				const name =
					input.name === undefined
						? numberedName(
								fields.map((other) => other.name),
								names.copy(field.name)
							)
						: freeName(fields, input.name, 'field', table.name);
				const made = duplicateField(ctx.ws, field.id, name);
				ctx.commit({ summary: words.newField(name, table.name), changes: made.changes });
				return { created: made.id };
			}
			if (input.view !== undefined) {
				const view = findView(ctx.ws, table, input.view);
				const name = givenName(input.name ?? names.copy(view.name), 'view');
				const made = duplicateView(ctx.ws, view.id, name);
				ctx.commit({ summary: words.newView(name, table.name), changes: made.changes });
				return { created: made.id };
			}
			const tables = ctx.ws.tables(base.id);
			const name =
				input.name === undefined
					? numberedName(
							tables.map((other) => other.name),
							names.copy(table.name)
						)
					: freeName(tables, input.name, 'table', base.name);
			const made = duplicateTable(ctx.ws, table.id, name);
			ctx.commit({ summary: words.newTable(name), changes: made.changes });
			return { created: made.id };
		}
	},
	{
		name: 'update_view',
		title: TITLES.update_view,
		description:
			'Changes a view: its name, or its settings (sort, filter and hidden fields of a grid, the fields of an entry, a list or a chart). Only the settings given change; null clears a sort or a filter.',
		input: z.strictObject({
			base: BASE,
			table: TABLE,
			view: z.string().describe('name or id of the view'),
			name: z.string().min(1).optional(),
			config: VIEW_CONFIG.optional()
		}),
		output: z.strictObject({ updated: z.string() }),
		kind: 'write',
		destructive: true,
		idempotent: true,
		run: (
			ctx,
			input: {
				base: string;
				table: string;
				view: string;
				name?: string;
				config?: z.infer<typeof VIEW_CONFIG>;
			}
		) => {
			const base = findBase(ctx.ws, input.base);
			const table = findTable(ctx.ws, base.id, input.table);
			const view = findView(ctx.ws, table, input.view);
			const set: Record<string, Value> = {};
			if (input.name !== undefined) set.name = givenName(input.name, 'view');
			if (input.config !== undefined) {
				set.config = { ...view.config, ...viewConfig(ctx.ws, table.id, input.config) } as Value;
			}
			ctx.commit({
				summary: words.changeView(view.name, table.name),
				changes: updateRecord(ctx.ws, view.id, set)
			});
			return { updated: view.id };
		}
	},
	{
		name: 'import_file',
		title: TITLES.import_file,
		description:
			'Imports an attached file (CSV, TSV, Excel, JSON) whole: into a new table named `name`, or appended to an existing `table`, its columns matched to fields by name. A Torsel backup restores its bases.',
		input: z.strictObject({
			file: z.string().describe('id of the attached file'),
			base: BASE.optional().describe(
				'name or id of the base; leave it out for the default base, unless the person names one'
			),
			table: TABLE.optional().describe('an existing table to append the rows to'),
			name: z.string().min(1).optional().describe('the new table, when not appending')
		}),
		output: z.strictObject({
			restored: z.number().optional(),
			added: z.number().optional(),
			unread: z.number().optional(),
			id: z.string().optional(),
			base: z.string().optional(),
			rows: z.number().optional()
		}),
		kind: 'write',
		destructive: true,
		idempotent: false,
		run: (ctx, input: { file: string; base?: string; table?: string; name?: string }) => {
			const sheet = ctx.sheet?.(input.file) ?? null;
			if (sheet === null) {
				throw new ToolError(`no attached file ${input.file} that reads as a table`);
			}
			if (sheet.kind === 'backup') {
				const changes = restoreChanges(ctx.ws, sheet.records);
				ctx.commit({ summary: words.restore(sheet.name), changes });
				return { restored: sheet.records.length };
			}
			const base =
				input.base === undefined
					? homeBase(ctx.ws, names)
					: { id: findBase(ctx.ws, input.base).id, changes: [] };
			const columns = guessColumns(sheet.rows, names);
			if (input.table !== undefined) {
				const table = findTable(ctx.ws, base.id, input.table);
				const targets = guessTargets(columns, ctx.ws.fields(table.id));
				const made = appendRows(ctx.ws, names, table.id, sheet.rows, columns, targets);
				ctx.commit({
					summary: words.importRows(made.count, table.name),
					changes: made.changes
				});
				return { added: made.count, unread: made.unread };
			}
			const tables = ctx.ws.tables(base.id);
			const name =
				input.name === undefined
					? numberedName(
							tables.map((table) => table.name),
							sheet.name.replace(/\.[^.]+$/u, '')
						)
					: freeName(tables, input.name, 'table', ctx.ws.base(base.id)?.name ?? base.id);
			const made = importTable(ctx.ws, names, base.id, name, sheet.rows, columns);
			ctx.commit({
				summary: words.newTableFrom(name, sheet.name),
				changes: [...base.changes, ...made.changes]
			});
			return { id: made.id, base: base.id, rows: sheet.rows.length - 1 };
		}
	},
	{
		name: 'open',
		title: TITLES.open,
		description:
			'Shows the person a table (and one of its views), their home page with every table, or the settings page: one they ask to see, or a table you just made. Never the screen already open.',
		input: z.strictObject({
			table: z.string().optional().describe('name or id of the table'),
			view: z.string().optional().describe('name or id of one of its views'),
			page: z.enum(['home', 'settings']).optional()
		}),
		output: z.strictObject({ shown: z.string() }),
		kind: 'screen',
		destructive: false,
		idempotent: true,
		run: (ctx, input: { table?: string; view?: string; page?: 'home' | 'settings' }) => {
			if (input.table === undefined) {
				ctx.show?.({ kind: input.page ?? 'home' });
				return { shown: input.page ?? 'home' };
			}
			const table = resolve(
				ctx.ws.bases().flatMap((base) => ctx.ws.tables(base.id)),
				input.table,
				'table',
				''
			);
			const view = input.view === undefined ? undefined : findView(ctx.ws, table, input.view);
			ctx.show?.({ kind: 'open', table: table.id, view: view?.id ?? null });
			return { shown: table.id };
		}
	},
	{
		name: 'export',
		title: TITLES.export,
		description: 'Downloads a backup of every base to the person’s device, as Settings does.',
		input: z.strictObject({}),
		output: z.strictObject({ downloading: z.boolean() }),
		kind: 'screen',
		destructive: false,
		idempotent: true,
		run: (ctx) => {
			ctx.show?.({ kind: 'export' });
			return { downloading: true };
		}
	},
	{
		name: 'export_table',
		title: TITLES.export_table,
		description:
			"Downloads a table to the person's device as a CSV file, as its menu's Export as CSV does: the fields, sort and filter of a grid view, the first grid when no view is given.",
		input: z.strictObject({
			table: z.string().describe('name or id of the table'),
			view: z.string().optional().describe('name or id of one of its grid views')
		}),
		output: z.strictObject({ downloading: z.string() }),
		kind: 'screen',
		destructive: false,
		idempotent: true,
		run: (ctx, input: { table: string; view?: string }) => {
			const table = resolve(
				ctx.ws.bases().flatMap((base) => ctx.ws.tables(base.id)),
				input.table,
				'table',
				''
			);
			const view = input.view === undefined ? undefined : findView(ctx.ws, table, input.view);
			if (view !== undefined && view.type !== 'grid') {
				throw new ToolError(`"${view.name}" is not a grid view; give a grid view or none`);
			}
			ctx.show?.({ kind: 'csv', table: table.id, view: view?.id ?? null });
			return { downloading: table.id };
		}
	},
	{
		name: 'move',
		title: TITLES.move,
		description:
			'Moves a field among the fields of its table, or a view among the tabs of its table, to a position: 1 for first.',
		input: z.strictObject({
			base: BASE,
			table: TABLE,
			field: z.string().optional().describe('name or id of the field to move'),
			view: z.string().optional().describe('name or id of the view to move'),
			position: z.number().int().min(1)
		}),
		output: z.strictObject({ moved: z.string(), position: z.number() }),
		kind: 'write',
		destructive: false,
		idempotent: true,
		run: (
			ctx,
			input: { base: string; table: string; field?: string; view?: string; position: number }
		) => {
			const base = findBase(ctx.ws, input.base);
			const table = findTable(ctx.ws, base.id, input.table);
			if ((input.field === undefined) === (input.view === undefined)) {
				throw new ToolError('give field or view, one of them');
			}
			const moved =
				input.field === undefined
					? findView(ctx.ws, table, input.view as string)
					: findField(ctx.ws, table.id, input.field);
			const ids = (
				input.field === undefined ? ctx.ws.views(table.id) : ctx.ws.fields(table.id)
			).map((item) => item.id);
			const to = Math.min(input.position, ids.length) - 1;
			const changes = reorder(ctx.ws, shifted(ids, moved.id, to - ids.indexOf(moved.id)));
			if (changes.length > 0) {
				ctx.commit({
					summary:
						input.field === undefined
							? words.moveView(moved.name, table.name)
							: words.moveField(moved.name, table.name),
					changes
				});
			}
			return { moved: moved.id, position: to + 1 };
		}
	},
	...sourceTools((message) => {
		throw new ToolError(message);
	})
];

export function toolNamed(name: string): Tool | undefined {
	return TOOLS.find((tool) => tool.name === name);
}

function pathText(path: readonly PropertyKey[]): string {
	return path
		.map((part, index) =>
			typeof part === 'number' ? `[${part}]` : `${index === 0 ? '' : '.'}${String(part)}`
		)
		.join('');
}

function keysAt(schema: z.ZodType, path: readonly PropertyKey[]): string[] {
	let at: z.ZodType = schema;
	for (const part of [...path, null]) {
		while (at instanceof z.ZodOptional || at instanceof z.ZodNullable) {
			at = at.unwrap() as z.ZodType;
		}
		if (part === null) break;
		if (at instanceof z.ZodObject && typeof part === 'string' && part in at.shape) {
			at = at.shape[part] as z.ZodType;
		} else if (at instanceof z.ZodArray && typeof part === 'number') {
			at = at.element as z.ZodType;
		} else {
			return [];
		}
	}
	return at instanceof z.ZodObject ? Object.keys(at.shape) : [];
}

export function inputProblem(schema: z.ZodType, error: z.ZodError): string {
	return error.issues
		.slice(0, 5)
		.map((issue) => {
			const at = pathText(issue.path) || 'input';
			if (issue.code === 'unrecognized_keys') {
				const known = keysAt(schema, issue.path);
				const keys = issue.keys.map((key) => JSON.stringify(key)).join(', ');
				return `${at} takes no ${keys}${known.length > 0 ? `; it takes ${known.join(', ')}` : ''}`;
			}
			return `${at}: ${issue.message}`;
		})
		.join('; ');
}

/** The keys a change gives a new value: all of them for a record it creates. */
function changedKeys(ws: Workspace, change: Change): string[] {
	const rec = ws.get(change.id);
	return Object.keys(change.set).filter(
		(key) => rec === undefined || !sameValue(rec.data[key], change.set[key])
	);
}

/** Refuses, before anything is written, changes the actor may not make, saying where to go instead. */
function refuseLocked(ws: Workspace, actor: Actor, changes: Change[]): void {
	const get = (id: string): Rec | undefined => ws.get(id);
	for (const change of changes) {
		const keys = lockedKeys(get, actor, change, changedKeys(ws, change));
		if (keys.length === 0) continue;
		const stored = ws.get(change.id);
		const tableId = stored?.parent ?? change.parent;
		const table = JSON.stringify(ws.table(tableId)?.name ?? tableId);
		if (
			change.kind === 'row' &&
			(stored === undefined || keys.includes(DELETED) || keys.includes(CREATED))
		) {
			throw new ToolError(
				`${table} gets its rows from its source: none can be added or deleted here`
			);
		}
		if (change.kind === 'row') {
			const locked = ws
				.fields(tableId)
				.filter((field) => hasPath(get(field.id)))
				.map((field) => JSON.stringify(field.name));
			throw new ToolError(
				`${table} gets ${locked.join(', ')} from its source: change them there, or add your own field beside them`
			);
		}
		if (keys.includes('type')) {
			const field = JSON.stringify(ws.field(change.id)?.name ?? change.id);
			throw new ToolError(`${field} in ${table} gets its type from its source`);
		}
		throw new ToolError(`only a source sets ${keys.join(', ')}`);
	}
}

export async function runTool(
	ctx: ToolContext,
	tool: Tool,
	raw: unknown
): Promise<{ ok: true; result: ToolResult } | { ok: false; error: string; failed?: true }> {
	const parsed = tool.input.safeParse(raw ?? {});
	if (!parsed.success) {
		return { ok: false, error: inputProblem(tool.input, parsed.error) };
	}

	const guarded: ToolContext = {
		...ctx,
		commit(action) {
			if (action.applied !== true) refuseLocked(ctx.ws, ctx.actor, action.changes);
			ctx.commit(action);
		}
	};

	try {
		return { ok: true, result: await tool.run(guarded, parsed.data as never) };
	} catch (error) {
		if (error instanceof ToolError) {
			return { ok: false, error: error.message };
		}
		console.error(`${tool.name} failed:`, error);
		return {
			ok: false,
			error: `${tool.name} failed on the server; nothing was written`,
			failed: true
		};
	}
}
