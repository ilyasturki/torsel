import { z } from 'zod';

import type { FieldSpec } from '../../core/actions.ts';
import {
	addField,
	createBase,
	createTable,
	createView,
	deleteRecords,
	homeBase,
	insertRows,
	updateRecord,
	updateRow
} from '../../core/actions.ts';
import { restoreChanges } from '../../core/backup.ts';
import { appendRows, guessColumns, guessTargets, importTable } from '../../core/csv.ts';
import type { MemoryEngine } from '../../core/engine.ts';
import { openEngine } from '../../core/engine.ts';
import { FormulaError, toDisplay, toStored } from '../../core/formula.ts';
import type {
	Change,
	Choice,
	FieldDef,
	FormatKey,
	TableDef,
	Value,
	ViewConfig
} from '../../core/model.ts';
import { FIELD_TYPES, FORMAT_OF, VIEW_TYPES, hasChoices } from '../../core/model.ts';
import { retypeField } from '../../core/retype.ts';
import { formulaProblem, formulaValues, materializeBase, readQuery } from '../../core/sql.ts';
import { coerce, parseCheck, ratingScale } from '../../core/values.ts';
import type { Effect } from '../../core/thread.ts';
import type { Workspace } from '../../core/workspace.ts';
import { nextChoice } from '../../ui/colors.ts';
import type { Sheet } from './files.ts';

export type Action = { summary: string; changes: Change[] };

export type ToolContext = {
	ws: Workspace;
	commit(action: Action): void;
	// What the app shows for the person; absent where there is no screen, as over MCP.
	show?(effect: Effect): void;
	sheet?(file: string): Sheet | null;
};

// `screen` tools act on what the person sees, `write` tools change records.
export type ToolKind = 'read' | 'write' | 'screen';

export type Tool = {
	name: string;
	title: string;
	description: string;
	input: z.ZodObject;
	kind: ToolKind;
	destructive?: boolean;
	run(ctx: ToolContext, input: never): Promise<unknown> | unknown;
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
	delete: 'Delete a base, table, field or view',
	import_file: 'Import a file',
	open: 'Open a table or page',
	export: 'Download a backup'
};

function same(a: string, b: string): boolean {
	return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function findBase(ws: Workspace, ref: string): { id: string; name: string } {
	const base = ws.base(ref) ?? ws.bases().find((candidate) => same(candidate.name, ref));
	if (base === undefined) {
		throw new ToolError(`no base "${ref}"; list_bases gives the names`);
	}
	return base;
}

export function findTable(ws: Workspace, baseId: string, ref: string): TableDef {
	const table = ws
		.tables(baseId)
		.find((candidate) => candidate.id === ref || same(candidate.name, ref));
	if (table === undefined) {
		throw new ToolError(`no table "${ref}" in this base; describe_base gives the names`);
	}
	return table;
}

export function findField(ws: Workspace, tableId: string, ref: string): FieldDef {
	const field = ws
		.fields(tableId)
		.find((candidate) => candidate.id === ref || same(candidate.name, ref));
	if (field === undefined) {
		throw new ToolError(`no field "${ref}" in this table`);
	}
	return field;
}

function choicesOf(names: string[] | undefined, previous: Choice[] = []): Choice[] {
	const choices: Choice[] = [];
	for (const name of names ?? []) {
		choices.push(previous.find((choice) => choice.name === name) ?? nextChoice(choices, name));
	}
	return choices;
}

function storedFormula(
	ws: Workspace,
	tableId: string,
	formula: string,
	fields?: FieldDef[]
): string {
	try {
		return toStored(formula, fields ?? ws.fields(tableId));
	} catch (error) {
		throw new ToolError(error instanceof FormulaError ? error.message : String(error));
	}
}

// Every query runs on the server's one thread, shared by every account.
const QUERY_SECONDS = 2;

function sqlRefusal(message: string): string {
	return message === 'interrupted'
		? `the query ran past ${QUERY_SECONDS} s; aggregate, filter or read fewer rows`
		: message;
}

const engines = new WeakMap<Workspace, Map<string, { version: number; engine: MemoryEngine }>>();
const versions = new WeakMap<Workspace, number>();

function bump(ws: Workspace): void {
	versions.set(ws, (versions.get(ws) ?? 0) + 1);
}

async function engineFor(ws: Workspace, baseId: string): Promise<MemoryEngine> {
	const version = versions.get(ws) ?? 0;
	let perBase = engines.get(ws);
	if (perBase === undefined) {
		perBase = new Map();
		engines.set(ws, perBase);
	}

	const cached = perBase.get(baseId);
	if (cached !== undefined && cached.version === version) {
		return cached.engine;
	}
	cached?.engine.close();

	const engine = await openEngine();
	materializeBase(engine, ws, baseId, true);
	engine.readOnly();
	engine.bound({ ms: QUERY_SECONDS * 1000, length: 1_000_000 });
	perBase.set(baseId, { version, engine });

	return engine;
}

async function validateFormula(ws: Workspace, tableId: string, stored: string): Promise<void> {
	const table = ws.table(tableId);
	if (table === undefined) {
		return;
	}
	const problem = formulaProblem(await engineFor(ws, table.base), ws, tableId, stored);
	if (problem !== null) {
		throw new ToolError(`SQLite refuses the formula: ${sqlRefusal(problem)}`);
	}
}

export function closeEngines(ws: Workspace): void {
	for (const { engine } of engines.get(ws)?.values() ?? []) {
		engine.close();
	}
	engines.delete(ws);
}

function commit(ctx: ToolContext, action: Action): void {
	ctx.commit(action);
	bump(ctx.ws);
}

const BASE = z.string().describe('name or id of the base');
const TABLE = z.string().describe('name or id of the table');
const ROW_VALUES = z
	.record(z.string(), z.unknown())
	.describe(
		'values by field name: text; a number (an amount for currency, points for percent: 25 for 25%, a score on the scale for rating); "h:mm:ss" or seconds for a duration; a YYYY-MM-DD date, YYYY-MM-DDTHH:MM for a datetime; a boolean for a check; the choice text; an array of choice texts for choices; the main text of the linked row; a URL, email or phone as text'
	);

const FORMAT = {
	decimals: z
		.number()
		.int()
		.min(0)
		.max(6)
		.optional()
		.describe('number, currency, percent: the decimals shown; leave out for automatic'),
	grouping: z
		.boolean()
		.optional()
		.describe('number: false for a year, an ID or a code, so 12345 never reads 12,345'),
	unit: z.string().optional().describe('number: shown after it, such as kg or km'),
	currency: z
		.string()
		.regex(/^[A-Z]{3}$/u)
		.optional()
		.describe('currency: the ISO code, such as EUR or USD'),
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

const FIELD = z.object({
	name: z.string().min(1),
	type: TYPE,
	...FORMAT,
	choices: z.array(z.string()).optional().describe('for a choice or choices field'),
	target: z.string().optional().describe('for a link field: the linked table'),
	formula: z
		.string()
		.optional()
		.describe(
			'for a formula field: an SQLite expression over the fields of the row, names in double quotes, such as "Weight" * (1 + "Reps" / 30.0). Divide by 30.0 rather than 30: SQLite divides integers as integers.'
		),
	description: z.string().optional().describe('one sentence saying what the field holds')
});

type FieldInput = z.infer<typeof FIELD>;

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

const VIEW_CONFIG = z
	.object({
		hidden: z.array(z.string()).optional().describe('grid: hidden fields'),
		sort: z
			.object({ field: z.string(), dir: z.enum(['asc', 'desc']) })
			.nullable()
			.optional()
			.describe('grid'),
		filter: z
			.object({ field: z.string(), text: z.string() })
			.nullable()
			.optional()
			.describe('grid: rows whose field contains the text'),
		fields: z.array(z.string()).optional().describe('entry: the fields to fill, in order'),
		match: z
			.array(z.string())
			.optional()
			.describe(
				'entry: the fields that identify "last time" for prefilling, in order, such as ["Exercise"]; with two or more, the first repeats its last occurrence row by row, such as ["Session", "Exercise"]'
			),
		group: z.string().optional().describe('list: the field to group by'),
		title: z.string().optional().describe('list: the field shown as the title'),
		show: z.array(z.string()).optional().describe('list: the fields shown under the title'),
		kind: z.enum(['bar', 'line']).optional().describe('chart'),
		x: z.string().optional().describe('chart: the x field, often a date'),
		bucket: z.enum(['day', 'week', 'month']).optional().describe('chart: how dates are grouped'),
		agg: z.enum(['count', 'sum', 'avg', 'max', 'min']).optional().describe('chart'),
		y: z.string().optional().describe('chart: the aggregated field, except for count'),
		color: z.string().optional().describe('chart: a choice field that splits the series'),
		rolling: z
			.number()
			.int()
			.min(2)
			.max(90)
			.optional()
			.describe('line chart: rolling average over N days')
	})
	.describe('the view settings, fields given by name');

function viewConfig(
	ws: Workspace,
	tableId: string,
	input: z.infer<typeof VIEW_CONFIG>
): ViewConfig {
	const id = (name: string | undefined): string | null =>
		name === undefined ? null : findField(ws, tableId, name).id;
	const ids = (names: string[] | undefined): string[] | undefined =>
		names?.map((name) => findField(ws, tableId, name).id);

	const config: ViewConfig = {};
	if (input.hidden !== undefined) config.hidden = ids(input.hidden);
	if (input.sort !== undefined)
		config.sort =
			input.sort === null
				? null
				: { field: findField(ws, tableId, input.sort.field).id, dir: input.sort.dir };
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
	if (rec?.kind !== 'row' || rec.parent !== table.id) {
		throw new ToolError(`no row ${id} in ${table.name}`);
	}
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
	if (ws.live(value)?.kind === 'row') {
		return value;
	}

	const primary = ws.fields(field.target).find((candidate) => candidate.type === 'text');
	const match = ws
		.rows(field.target)
		.find(
			(row) =>
				primary !== undefined &&
				typeof row.data[primary.id] === 'string' &&
				same(String(row.data[primary.id]), value)
		);

	if (match === undefined) {
		throw new ToolError(`no row "${value}" in the table "${field.name}" links to`);
	}
	return match.id;
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
				continue;
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

function describeField(ws: Workspace, field: FieldDef): Record<string, unknown> {
	const out: Record<string, unknown> = { id: field.id, name: field.name, type: field.type };

	for (const key of FORMAT_OF[field.type]) {
		if (field[key] !== null && !(key === 'grouping' && field[key])) out[key] = field[key];
	}
	if (hasChoices(field.type)) out.choices = field.choices.map((choice) => choice.name);
	if (field.type === 'link' && field.target !== null)
		out.target = ws.table(field.target)?.name ?? null;
	if (field.type === 'formula' && field.expr !== null)
		out.formula = toDisplay(field.expr, ws.fields(field.table));
	if (field.description !== null) out.description = field.description;

	return out;
}

function named(ws: Workspace, tableId: string, ids: string[] | undefined): string[] | undefined {
	return ids?.map((id) => ws.field(id)?.name ?? id);
}

function describeView(
	ws: Workspace,
	tableId: string,
	view: ReturnType<Workspace['views']>[number]
): Record<string, unknown> {
	const { widths: _widths, ...shown } = view.config;
	const config: Record<string, unknown> = { ...shown };
	if (view.config.filter)
		config.filter = {
			...view.config.filter,
			field: ws.field(view.config.filter.field)?.name ?? view.config.filter.field
		};
	for (const key of ['hidden', 'fields', 'match', 'show'] as const) {
		if (view.config[key] !== undefined) config[key] = named(ws, tableId, view.config[key]);
	}
	for (const key of ['group', 'title', 'x', 'y', 'color'] as const) {
		const id = view.config[key];
		if (typeof id === 'string') config[key] = ws.field(id)?.name ?? id;
	}
	return { id: view.id, name: view.name, type: view.type, config };
}

function plural(count: number, one: string): string {
	return `${count} ${one}${count === 1 ? '' : 's'}`;
}

export const TOOLS: Tool[] = [
	{
		name: 'list_bases',
		title: TITLES.list_bases,
		description: 'The bases of the person, with their tables and the row count of each table.',
		input: z.object({}),
		kind: 'read',
		run: ({ ws }) =>
			ws.bases().map((base) => ({
				id: base.id,
				name: base.name,
				tables: ws
					.tables(base.id)
					.map((table) => ({ id: table.id, name: table.name, rows: ws.rows(table.id).length }))
			}))
	},
	{
		name: 'describe_base',
		title: TITLES.describe_base,
		description:
			'The schema of a base: its tables, their fields (type, choices, formula, description) and their views.',
		input: z.object({ base: BASE }),
		kind: 'read',
		run: ({ ws }, { base }: { base: string }) => {
			const found = findBase(ws, base);
			return {
				id: found.id,
				name: found.name,
				tables: ws.tables(found.id).map((table) => ({
					id: table.id,
					name: table.name,
					rows: ws.rows(table.id).length,
					fields: ws.fields(table.id).map((field) => describeField(ws, field)),
					views: ws.views(table.id).map((view) => describeView(ws, table.id, view))
				}))
			};
		}
	},
	{
		name: 'query',
		title: TITLES.query,
		description:
			'A read-only SQLite SELECT on a base. Each table is a view named like the table, its columns named like its fields: select "Exercise", max("Weight") from "Sets" group by 1. The columns "_id" and "_created" (ms) exist too. Dates are YYYY-MM-DD text (YYYY-MM-DDTHH:MM with a time), checks are 0 or 1, a percent is its points (25 for 25%), a duration is seconds, a choices field is a JSON array of names (read it with json_each), a link reads as the text of the linked row. At most 200 rows and about 64 KB, and a query stops after 2 s: truncated is true when rows were cut, so aggregate, filter or select fewer columns.',
		input: z.object({ base: BASE, sql: z.string().min(1) }),
		kind: 'read',
		run: async ({ ws }, { base, sql }: { base: string; sql: string }) => {
			const found = findBase(ws, base);
			try {
				const { rows, truncated } = readQuery(await engineFor(ws, found.id), sql);
				return { rows, count: rows.length, truncated };
			} catch (error) {
				throw new ToolError(sqlRefusal(error instanceof Error ? error.message : String(error)));
			}
		}
	},
	{
		name: 'add_rows',
		title: TITLES.add_rows,
		description:
			'Adds rows to a table. Values are given by field name; a choice not seen before is added to its field.',
		input: z.object({ base: BASE, table: TABLE, rows: z.array(ROW_VALUES).min(1).max(500) }),
		kind: 'write',
		run: (ctx, input: { base: string; table: string; rows: Record<string, unknown>[] }) => {
			const base = findBase(ctx.ws, input.base);
			const table = findTable(ctx.ws, base.id, input.table);
			const { rows, fieldChanges } = rowsByName(
				ctx.ws,
				table.id,
				input.rows,
				(index) => `rows[${index}]`
			);
			const inserted = insertRows(ctx.ws, table.id, rows);
			commit(ctx, {
				summary: `Add ${plural(rows.length, 'row')} to ${table.name}`,
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
		input: z.object({
			base: BASE,
			table: TABLE,
			updates: z
				.array(z.object({ id: z.string(), values: ROW_VALUES }))
				.min(1)
				.max(500)
		}),
		run: (
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
			const { rows, fieldChanges } = rowsByName(
				ctx.ws,
				table.id,
				input.updates.map((update) => update.values),
				(index) => `updates[${index}].values`
			);
			const changes = input.updates.flatMap((update, index) =>
				updateRow(ctx.ws, update.id, rows[index])
			);
			commit(ctx, {
				summary: `Change ${plural(changes.length, 'row')} in ${table.name}`,
				changes: [...fieldChanges, ...changes]
			});
			return { updated: changes.length };
		}
	},
	{
		name: 'delete_rows',
		title: TITLES.delete_rows,
		description: 'Deletes rows named by their "_id".',
		input: z.object({ base: BASE, table: TABLE, ids: z.array(z.string()).min(1).max(1000) }),
		kind: 'write',
		destructive: true,
		run: (ctx, input: { base: string; table: string; ids: string[] }) => {
			const base = findBase(ctx.ws, input.base);
			const table = findTable(ctx.ws, base.id, input.table);
			for (const id of input.ids) {
				requireRow(ctx.ws, table, id);
			}
			commit(ctx, {
				summary: `Delete ${plural(input.ids.length, 'row')} from ${table.name}`,
				changes: deleteRecords(ctx.ws, input.ids)
			});
			return { deleted: input.ids.length };
		}
	},
	{
		name: 'create_base',
		title: TITLES.create_base,
		description: 'Creates an empty base, to fill with create_table afterwards.',
		input: z.object({ name: z.string().min(1) }),
		kind: 'write',
		run: (ctx, { name }: { name: string }) => {
			const made = createBase(ctx.ws, name);
			commit(ctx, { summary: `New base "${name}"`, changes: made.changes });
			return { id: made.id };
		}
	},
	{
		name: 'create_table',
		title: TITLES.create_table,
		description:
			'Creates a table with its fields and its Grid and Entry views. Formulas come afterwards through add_field, once the fields they read are in place.',
		kind: 'write',
		input: z.object({
			base: BASE.optional().describe(
				'name or id of the base; leave it out for the default base, unless the person names one'
			),
			name: z.string().min(1),
			fields: z
				.array(FIELD.omit({ formula: true }).extend({ type: TYPE.exclude(['formula']) }))
				.min(1)
		}),
		run: (ctx, input: { base?: string; name: string; fields: FieldInput[] }) => {
			const base =
				input.base === undefined
					? homeBase(ctx.ws)
					: { id: findBase(ctx.ws, input.base).id, changes: [] };
			const specs = input.fields.map((field) => fieldSpec(ctx.ws, base.id, field));
			const made = createTable(ctx.ws, base.id, input.name, specs);
			commit(ctx, {
				summary: `New table "${input.name}"`,
				changes: [...base.changes, ...made.changes]
			});
			return { id: made.id, base: base.id };
		}
	},
	{
		name: 'add_field',
		title: TITLES.add_field,
		description:
			'Adds a field to a table, a computed one (formula) included. SQLite checks a formula first.',
		input: FIELD.extend({ base: BASE, table: TABLE }),
		kind: 'write',
		run: async (ctx, input: FieldInput & { base: string; table: string }) => {
			const base = findBase(ctx.ws, input.base);
			const table = findTable(ctx.ws, base.id, input.table);
			const spec = fieldSpec(ctx.ws, base.id, input, table.id);
			if (spec.expr != null) {
				await validateFormula(ctx.ws, table.id, spec.expr);
			}
			const made = addField(ctx.ws, table.id, spec);
			commit(ctx, {
				summary: `New field "${input.name}" in ${table.name}`,
				changes: made.changes
			});
			return { id: made.id };
		}
	},
	{
		name: 'update_field',
		title: TITLES.update_field,
		description:
			'Renames a field, or changes its type, format, choices, formula or description. A new type or scale converts every value; `lost` counts those it cannot hold, now empty.',
		kind: 'write',
		input: z.object({
			base: BASE,
			table: TABLE,
			field: z.string(),
			name: z.string().min(1).optional(),
			type: TYPE.optional(),
			...FORMAT,
			target: z.string().optional().describe('for a field becoming a link: the linked table'),
			choices: z.array(z.string()).optional(),
			formula: z.string().optional(),
			description: z.string().optional()
		}),
		run: async (
			ctx,
			input: FormatInput & {
				base: string;
				table: string;
				field: string;
				name?: string;
				type?: FieldDef['type'];
				target?: string;
				choices?: string[];
				formula?: string;
				description?: string;
			}
		) => {
			const base = findBase(ctx.ws, input.base);
			const table = findTable(ctx.ws, base.id, input.table);
			const field = findField(ctx.ws, table.id, input.field);
			const type = input.type ?? field.type;
			const set: Record<string, Value> = {};
			if (input.name !== undefined) set.name = input.name.trim();
			if (input.description !== undefined) set.description = input.description;
			let expr: string | null = null;
			if (input.formula !== undefined) {
				if (type !== 'formula') throw new ToolError(`"${field.name}" is not a computed field`);
				expr = storedFormula(
					ctx.ws,
					table.id,
					input.formula,
					ctx.ws.fields(table.id).filter((other) => other.id !== field.id)
				);
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
								[
									...formulaValues(await engineFor(ctx.ws, base.id), ctx.ws, table.id, field.expr)
								].map(([row, value]) => [row, { [field.id]: value }])
							)
						: undefined;
				converted = retypeField(
					ctx.ws,
					field.id,
					{
						type,
						...format,
						target:
							input.target === undefined
								? field.target
								: findTable(ctx.ws, base.id, input.target).id,
						expr: expr ?? field.expr,
						choices:
							input.choices === undefined ? undefined : choicesOf(input.choices, field.choices)
					},
					computed
				);
			}
			// A retype's own field change already holds the given choices plus those found in values.
			if (input.choices !== undefined && converted.changes.length === 0)
				set.choices = choicesOf(input.choices, field.choices);
			commit(ctx, {
				summary: `Change field "${field.name}" in ${table.name}`,
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
		input: z.object({
			base: BASE,
			table: TABLE,
			name: z.string().min(1),
			type: z.enum(VIEW_TYPES),
			config: VIEW_CONFIG
		}),
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
			const made = createView(ctx.ws, table.id, {
				name: input.name,
				type: input.type,
				config: viewConfig(ctx.ws, table.id, input.config)
			});
			commit(ctx, {
				summary: `New view "${input.name}" on ${table.name}`,
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
		input: z.object({ base: BASE, id: z.string() }),
		kind: 'write',
		destructive: true,
		run: (ctx, input: { base: string; id: string }) => {
			const base = findBase(ctx.ws, input.base);
			const rec = ctx.ws.live(input.id);
			if (
				rec === undefined ||
				rec.base !== base.id ||
				!['base', 'table', 'field', 'view'].includes(rec.kind)
			) {
				throw new ToolError(`no base, table, field or view ${input.id} in ${base.name}`);
			}
			const name = typeof rec.data.name === 'string' ? rec.data.name : rec.id;
			commit(ctx, {
				summary: `Delete ${rec.kind} "${name}"`,
				changes: deleteRecords(ctx.ws, [rec.id])
			});
			return { deleted: rec.id };
		}
	},
	{
		name: 'rename',
		title: TITLES.rename,
		description: 'Renames a base, a table or a view by its id.',
		input: z.object({ base: BASE, id: z.string(), name: z.string().min(1) }),
		kind: 'write',
		run: (ctx, input: { base: string; id: string; name: string }) => {
			const base = findBase(ctx.ws, input.base);
			const rec = ctx.ws.live(input.id);
			if (
				rec === undefined ||
				rec.base !== base.id ||
				!['base', 'table', 'view'].includes(rec.kind)
			) {
				throw new ToolError(`no base, table or view ${input.id} in ${base.name}`);
			}
			const before = typeof rec.data.name === 'string' ? rec.data.name : rec.id;
			commit(ctx, {
				summary: `Rename ${rec.kind} "${before}" to "${input.name.trim()}"`,
				changes: updateRecord(ctx.ws, rec.id, { name: input.name.trim() })
			});
			return { renamed: rec.id };
		}
	},
	{
		name: 'update_view',
		title: TITLES.update_view,
		description:
			'Changes a view: its name, or its settings (sort, filter and hidden fields of a grid, the fields of an entry, a list or a chart). Only the settings given change; null clears a sort or a filter.',
		input: z.object({
			base: BASE,
			table: TABLE,
			view: z.string().describe('name or id of the view'),
			name: z.string().min(1).optional(),
			config: VIEW_CONFIG.optional()
		}),
		kind: 'write',
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
			const view = ctx.ws
				.views(table.id)
				.find((candidate) => candidate.id === input.view || same(candidate.name, input.view));
			if (view === undefined) {
				throw new ToolError(`no view "${input.view}" on ${table.name}`);
			}
			const set: Record<string, Value> = {};
			if (input.name !== undefined) set.name = input.name.trim();
			if (input.config !== undefined) {
				set.config = { ...view.config, ...viewConfig(ctx.ws, table.id, input.config) } as Value;
			}
			commit(ctx, {
				summary: `Change view "${view.name}" on ${table.name}`,
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
		input: z.object({
			file: z.string().describe('id of the attached file'),
			base: BASE.optional().describe(
				'name or id of the base; leave it out for the default base, unless the person names one'
			),
			table: TABLE.optional().describe('an existing table to append the rows to'),
			name: z.string().min(1).optional().describe('the new table, when not appending')
		}),
		kind: 'write',
		run: (ctx, input: { file: string; base?: string; table?: string; name?: string }) => {
			const sheet = ctx.sheet?.(input.file) ?? null;
			if (sheet === null) {
				throw new ToolError(`no attached file ${input.file} that reads as a table`);
			}
			if (sheet.kind === 'backup') {
				const changes = restoreChanges(ctx.ws, sheet.records);
				commit(ctx, { summary: `Restore ${sheet.name}`, changes });
				return { restored: sheet.records.length };
			}
			const base =
				input.base === undefined
					? homeBase(ctx.ws)
					: { id: findBase(ctx.ws, input.base).id, changes: [] };
			const columns = guessColumns(sheet.rows);
			if (input.table !== undefined) {
				const table = findTable(ctx.ws, base.id, input.table);
				const targets = guessTargets(columns, ctx.ws.fields(table.id));
				const made = appendRows(ctx.ws, table.id, sheet.rows, columns, targets);
				commit(ctx, {
					summary: `Import ${plural(made.count, 'row')} into ${table.name}`,
					changes: made.changes
				});
				return { added: made.count, unread: made.unread };
			}
			const name = input.name ?? sheet.name.replace(/\.[^.]+$/u, '');
			const made = importTable(ctx.ws, base.id, name, sheet.rows, columns);
			commit(ctx, {
				summary: `New table "${name}" from ${sheet.name}`,
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
		input: z.object({
			table: z.string().optional().describe('name or id of the table'),
			view: z.string().optional().describe('name or id of one of its views'),
			page: z.enum(['home', 'settings']).optional()
		}),
		kind: 'screen',
		run: (ctx, input: { table?: string; view?: string; page?: 'home' | 'settings' }) => {
			if (input.table === undefined) {
				ctx.show?.({ kind: input.page ?? 'home' });
				return { shown: input.page ?? 'home' };
			}
			const ref = input.table;
			const table = ctx.ws
				.bases()
				.flatMap((base) => ctx.ws.tables(base.id))
				.find((candidate) => candidate.id === ref || same(candidate.name, ref));
			if (table === undefined) {
				throw new ToolError(`no table "${ref}"`);
			}
			const view =
				input.view === undefined
					? undefined
					: ctx.ws
							.views(table.id)
							.find(
								(candidate) => candidate.id === input.view || same(candidate.name, input.view ?? '')
							);
			if (input.view !== undefined && view === undefined) {
				throw new ToolError(`no view "${input.view}" on ${table.name}`);
			}
			ctx.show?.({ kind: 'open', table: table.id, view: view?.id ?? null });
			return { shown: table.id };
		}
	},
	{
		name: 'export',
		title: TITLES.export,
		description: 'Downloads a backup of every base to the person’s device, as Settings does.',
		input: z.object({}),
		kind: 'screen',
		run: (ctx) => {
			ctx.show?.({ kind: 'export' });
			return { downloading: true };
		}
	}
];

export function toolNamed(name: string): Tool | undefined {
	return TOOLS.find((tool) => tool.name === name);
}

export async function runTool(
	ctx: ToolContext,
	tool: Tool,
	raw: unknown
): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
	const parsed = tool.input.safeParse(raw);
	if (!parsed.success) {
		return { ok: false, error: z.prettifyError(parsed.error) };
	}

	try {
		return { ok: true, result: await tool.run(ctx, parsed.data as never) };
	} catch (error) {
		if (error instanceof ToolError) {
			return { ok: false, error: error.message };
		}
		throw error;
	}
}
