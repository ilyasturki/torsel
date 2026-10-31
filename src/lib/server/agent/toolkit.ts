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
import type { MemoryEngine } from '../../core/engine.ts';
import { openEngine } from '../../core/engine.ts';
import { FormulaError, toDisplay, toStored } from '../../core/formula.ts';
import type { Change, Choice, FieldDef, TableDef, Value, ViewConfig } from '../../core/model.ts';
import { FIELD_TYPES, VIEW_TYPES } from '../../core/model.ts';
import { formulaProblem, materializeBase, readQuery } from '../../core/sql.ts';
import type { Tier } from '../../core/thread.ts';
import { TOOL_TITLES } from '../../core/thread.ts';
import type { Workspace } from '../../core/workspace.ts';

export type { Tier };

export type Action = { tier: Tier; summary: string; changes: Change[]; detail?: string[] };

export type ToolContext = {
	ws: Workspace;
	commit(action: Action): void;
};

type RunContext = {
	ws: Workspace;
	commit(action: Omit<Action, 'tier'>): void;
};

export type Tool = {
	name: string;
	title: string;
	description: string;
	input: z.ZodObject;
	tier: Tier | 'read';
	run(ctx: RunContext, input: never): Promise<unknown> | unknown;
};

export class ToolError extends Error {
	public constructor(message: string) {
		super(message);
		this.name = 'ToolError';
	}
}

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
	return (names ?? []).map((name) => ({
		name,
		color: previous.find((choice) => choice.name === name)?.color ?? null
	}));
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
		throw new ToolError(`SQLite refuses the formula: ${problem}`);
	}
}

export function closeEngines(ws: Workspace): void {
	for (const { engine } of engines.get(ws)?.values() ?? []) {
		engine.close();
	}
	engines.delete(ws);
}

function commit(ctx: RunContext, action: Omit<Action, 'tier'>): void {
	ctx.commit(action);
	bump(ctx.ws);
}

const BASE = z.string().describe('name or id of the base');
const TABLE = z.string().describe('name or id of the table');
const ROW_VALUES = z
	.record(z.string(), z.unknown())
	.describe(
		'values by field name: a number, text, a YYYY-MM-DD date, a boolean for a check, the choice text, the main text of the linked row'
	);

const FIELD = z.object({
	name: z.string().min(1),
	type: z.enum(FIELD_TYPES),
	choices: z.array(z.string()).optional().describe('for a choice field'),
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
		description: input.description ?? null
	};

	if (input.type === 'choice') {
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
			.optional()
			.describe('grid'),
		fields: z.array(z.string()).optional().describe('entry: the fields to fill, in order'),
		match: z
			.array(z.string())
			.optional()
			.describe('entry: the fields that identify "last time" for prefilling, such as ["Exercise"]'),
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
		config.sort = { field: findField(ws, tableId, input.sort.field).id, dir: input.sort.dir };
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
	rows: Record<string, unknown>[]
): { rows: Record<string, unknown>[]; fieldChanges: Change[] } {
	const fields = ws.fields(tableId);
	const added = new Map<string, Set<string>>();

	const out = rows.map((values) => {
		const row: Record<string, unknown> = {};
		for (const [name, value] of Object.entries(values)) {
			const field = findField(ws, tableId, name);
			if (field.type === 'formula') {
				continue;
			}
			if (field.type === 'choice' && typeof value === 'string' && value.trim() !== '') {
				if (!field.choices.some((choice) => choice.name === value.trim())) {
					let names = added.get(field.id);
					if (names === undefined) {
						names = new Set();
						added.set(field.id, names);
					}
					names.add(value.trim());
				}
			}
			row[field.id] = linkValue(ws, field, value);
		}
		return row;
	});

	const fieldChanges = [...added].flatMap(([fieldId, names]) => {
		const field = fields.find((candidate) => candidate.id === fieldId) as FieldDef;
		const choices: Value = [...field.choices, ...[...names].map((name) => ({ name, color: null }))];
		return updateRecord(ws, fieldId, { choices });
	});

	return { rows: out, fieldChanges };
}

function describeField(ws: Workspace, field: FieldDef): Record<string, unknown> {
	const out: Record<string, unknown> = { id: field.id, name: field.name, type: field.type };

	if (field.type === 'choice') out.choices = field.choices.map((choice) => choice.name);
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

const LISTED = 20;

function rowLabel(ws: Workspace, id: string): string {
	const row = ws.live(id);
	if (row === undefined) {
		return id;
	}
	const values = ws
		.fields(row.parent)
		.filter((field) => field.type !== 'formula')
		.map((field) => {
			const value = row.data[field.id];
			if (value === undefined || value === null || value === '') return null;
			return field.type === 'link' && typeof value === 'string'
				? ws.rowTitle(value)
				: String(value);
		})
		.filter((value) => value !== null);
	return values.slice(0, 4).join(', ') || id;
}

function listed(labels: string[]): string[] {
	return labels.length > LISTED
		? [...labels.slice(0, LISTED), `and ${labels.length - LISTED} more`]
		: labels;
}

export const TOOLS: Tool[] = [
	{
		name: 'list_bases',
		title: TOOL_TITLES.list_bases,
		description: 'The bases of the person, with their tables and the row count of each table.',
		input: z.object({}),
		tier: 'read',
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
		title: TOOL_TITLES.describe_base,
		description:
			'The schema of a base: its tables, their fields (type, choices, formula, description) and their views. Read it before writing a query or changing anything.',
		input: z.object({ base: BASE }),
		tier: 'read',
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
		title: TOOL_TITLES.query,
		description:
			'A read-only SQLite SELECT on a base. Each table is a view named like the table, its columns named like its fields: select "Exercise", max("Weight") from "Sets" group by 1. The columns "_id" and "_created" (ms) exist too. Dates are YYYY-MM-DD text, checks are 0 or 1, a link reads as the text of the linked row. 200 rows at most.',
		input: z.object({ base: BASE, sql: z.string().min(1) }),
		tier: 'read',
		run: async ({ ws }, { base, sql }: { base: string; sql: string }) => {
			const found = findBase(ws, base);
			try {
				const rows = readQuery(await engineFor(ws, found.id), sql);
				return { rows, count: rows.length };
			} catch (error) {
				throw new ToolError(error instanceof Error ? error.message : String(error));
			}
		}
	},
	{
		name: 'add_rows',
		title: TOOL_TITLES.add_rows,
		description:
			'Adds rows to a table. Values are given by field name; a choice not seen before is added to its field.',
		input: z.object({ base: BASE, table: TABLE, rows: z.array(ROW_VALUES).min(1).max(500) }),
		tier: 'apply',
		run: (ctx, input: { base: string; table: string; rows: Record<string, unknown>[] }) => {
			const base = findBase(ctx.ws, input.base);
			const table = findTable(ctx.ws, base.id, input.table);
			const { rows, fieldChanges } = rowsByName(ctx.ws, table.id, input.rows);
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
		title: TOOL_TITLES.update_rows,
		description: 'Changes existing rows, named by their "_id". Only the fields given change.',
		tier: 'apply',
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
			const { rows, fieldChanges } = rowsByName(
				ctx.ws,
				table.id,
				input.updates.map((update) => update.values)
			);
			const changes = input.updates.flatMap((update, index) => {
				if (ctx.ws.live(update.id)?.parent !== table.id) {
					throw new ToolError(`no row ${update.id} in ${table.name}`);
				}
				return updateRow(ctx.ws, update.id, rows[index]);
			});
			commit(ctx, {
				summary: `Change ${plural(changes.length, 'row')} in ${table.name}`,
				changes: [...fieldChanges, ...changes]
			});
			return { updated: changes.length };
		}
	},
	{
		name: 'delete_rows',
		title: TOOL_TITLES.delete_rows,
		description: 'Deletes rows named by their "_id".',
		input: z.object({ base: BASE, table: TABLE, ids: z.array(z.string()).min(1).max(1000) }),
		tier: 'confirm',
		run: (ctx, input: { base: string; table: string; ids: string[] }) => {
			const base = findBase(ctx.ws, input.base);
			const table = findTable(ctx.ws, base.id, input.table);
			for (const id of input.ids) {
				if (ctx.ws.live(id)?.parent !== table.id) {
					throw new ToolError(`no row ${id} in ${table.name}`);
				}
			}
			commit(ctx, {
				summary: `Delete ${plural(input.ids.length, 'row')} from ${table.name}`,
				detail: listed(input.ids.map((id) => rowLabel(ctx.ws, id))),
				changes: deleteRecords(ctx.ws, input.ids)
			});
			return { deleted: input.ids.length };
		}
	},
	{
		name: 'create_base',
		title: TOOL_TITLES.create_base,
		description: 'Creates an empty base, to fill with create_table afterwards.',
		input: z.object({ name: z.string().min(1) }),
		tier: 'propose',
		run: (ctx, { name }: { name: string }) => {
			const made = createBase(ctx.ws, name);
			commit(ctx, { summary: `New base "${name}"`, changes: made.changes });
			return { id: made.id };
		}
	},
	{
		name: 'create_table',
		title: TOOL_TITLES.create_table,
		description:
			'Creates a table with its fields and its Grid and Entry views. Formulas come afterwards through add_field, once the fields they read are in place.',
		tier: 'propose',
		input: z.object({
			base: BASE.optional().describe(
				'name or id of the base; leave it out for the default base, unless the person names one'
			),
			name: z.string().min(1),
			fields: z
				.array(
					FIELD.omit({ formula: true }).extend({
						type: z.enum(['text', 'number', 'date', 'choice', 'check', 'link'])
					})
				)
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
		title: TOOL_TITLES.add_field,
		description:
			'Adds a field to a table, a computed one (formula) included. SQLite checks a formula first.',
		input: FIELD.extend({ base: BASE, table: TABLE }),
		tier: 'propose',
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
		title: TOOL_TITLES.update_field,
		description: 'Renames a field, or changes its choices, formula or description.',
		tier: 'propose',
		input: z.object({
			base: BASE,
			table: TABLE,
			field: z.string(),
			name: z.string().min(1).optional(),
			choices: z.array(z.string()).optional(),
			formula: z.string().optional(),
			description: z.string().optional()
		}),
		run: async (
			ctx,
			input: {
				base: string;
				table: string;
				field: string;
				name?: string;
				choices?: string[];
				formula?: string;
				description?: string;
			}
		) => {
			const base = findBase(ctx.ws, input.base);
			const table = findTable(ctx.ws, base.id, input.table);
			const field = findField(ctx.ws, table.id, input.field);
			const set: Record<string, Value> = {};
			if (input.name !== undefined) set.name = input.name.trim();
			if (input.choices !== undefined) set.choices = choicesOf(input.choices, field.choices);
			if (input.description !== undefined) set.description = input.description;
			if (input.formula !== undefined) {
				if (field.type !== 'formula')
					throw new ToolError(`"${field.name}" is not a computed field`);
				set.expr = storedFormula(ctx.ws, table.id, input.formula);
				await validateFormula(ctx.ws, table.id, set.expr);
			}
			commit(ctx, {
				summary: `Change field "${field.name}" in ${table.name}`,
				changes: updateRecord(ctx.ws, field.id, set)
			});
			return { updated: field.id };
		}
	},
	{
		name: 'create_view',
		title: TOOL_TITLES.create_view,
		description:
			'Adds a view to a table: grid (the spreadsheet), entry (fast input on a phone, prefilled from the last row with the same match values), list (grouped cards) or chart (bars or a line of an aggregate).',
		tier: 'propose',
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
		title: TOOL_TITLES.delete,
		description: 'Deletes a table, a field or a view by its id (describe_base gives them).',
		input: z.object({ base: BASE, id: z.string() }),
		tier: 'confirm',
		run: (ctx, input: { base: string; id: string }) => {
			const base = findBase(ctx.ws, input.base);
			const rec = ctx.ws.live(input.id);
			if (
				rec === undefined ||
				rec.base !== base.id ||
				!['table', 'field', 'view'].includes(rec.kind)
			) {
				throw new ToolError(`no table, field or view ${input.id} in ${base.name}`);
			}
			const name = typeof rec.data.name === 'string' ? rec.data.name : rec.id;
			const rows = rec.kind === 'table' ? ctx.ws.rows(rec.id).length : 0;
			commit(ctx, {
				summary: `Delete ${rec.kind} "${name}"`,
				detail:
					rec.kind === 'table'
						? [`The table and its ${plural(rows, 'row')}`]
						: rec.kind === 'field'
							? ['The field and the values of every row in it']
							: ['The view only, no data'],
				changes: deleteRecords(ctx.ws, [rec.id])
			});
			return { deleted: rec.id };
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

	const run: RunContext = {
		ws: ctx.ws,
		commit: (action) => ctx.commit({ ...action, tier: tool.tier as Tier })
	};

	try {
		return { ok: true, result: await tool.run(run, parsed.data as never) };
	} catch (error) {
		if (error instanceof ToolError) {
			return { ok: false, error: error.message };
		}
		throw error;
	}
}
