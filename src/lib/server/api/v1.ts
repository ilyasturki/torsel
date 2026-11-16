import type { RequestEvent } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { z } from 'zod';

import type { Rec } from '../../core/model.ts';
import type { Workspace } from '../../core/workspace.ts';
import { perMinute } from '../auth/rate-limit.ts';
import type { Credential } from '../auth/session.ts';
import { apiCallsPerMinute } from '../config.ts';
import type { Database } from '../db/client.ts';
import { loadWorkspace } from '../db/records.ts';
import type { McpCaller } from '../agent/mcp.ts';
import { callerOf, execute, sqlTurn } from '../agent/mcp.ts';
import type { Tool, ToolResult } from '../agent/toolkit.ts';
import {
	ROW_VALUES,
	findBase,
	findField,
	findTable,
	inputProblem,
	toolNamed
} from '../agent/toolkit.ts';
import { CHANGES, readChanges } from './changes.ts';
import { ApiError, errorResponse, located } from './errors.ts';
import type { Keys } from './rows.ts';
import { ROW, after, readRowCursor, rowCursor, shapeRows } from './rows.ts';

export type Access = 'read' | 'write';

type Context = {
	db: Database;
	caller: McpCaller;
	params: Record<string, string>;
	query: Record<string, unknown>;
	body: unknown;
};

export type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export type Operation = {
	id: string;
	method: Method;
	/** Under `/api/v1`, OpenAPI style. */
	path: string;
	summary: string;
	description?: string;
	access: Access;
	query?: z.ZodObject;
	body?: z.ZodType;
	status: 200 | 201;
	response: z.ZodType;
	run(ctx: Context): Promise<unknown> | unknown;
};

export const PARAMS: Record<string, string> = {
	base: 'name or id of the base; a name with a slash needs the id',
	table: 'name or id of the table; a name with a slash needs the id',
	row: 'id of the row'
};

function tool(name: string): Tool {
	const found = toolNamed(name);
	if (found === undefined) throw new Error(`no tool ${name}`);
	return found;
}

const LIST_BASES = tool('list_bases');
const DESCRIBE_BASE = tool('describe_base');
const QUERY = tool('query');
const ADD_ROWS = tool('add_rows');
const UPDATE_ROWS = tool('update_rows');
const DELETE_ROWS = tool('delete_rows');

type Place = { ws: Workspace; base: string; table: string };

function place(ctx: Context): Place {
	const ws = loadWorkspace(ctx.db, ctx.caller.userId);
	const base = located(() => findBase(ws, ctx.params.base)).id;
	const table =
		ctx.params.table === undefined ? '' : located(() => findTable(ws, base, ctx.params.table)).id;
	return { ws, base, table };
}

function liveRow(ws: Workspace, table: string, id: string): Rec {
	const rec = ws.live(id);
	if (rec?.kind !== 'row' || rec.parent !== table) {
		throw new ApiError(404, 'not_found', `no row ${id} in ${ws.table(table)?.name ?? table}`);
	}
	return rec;
}

async function run(
	ctx: Context,
	used: Tool,
	input: Record<string, unknown>
): Promise<{ result: ToolResult; ws: Workspace }> {
	const { outcome, ws } = await execute(ctx.db, ctx.caller, used, input, 'api');
	if (outcome.ok) {
		return { result: outcome.result, ws };
	}
	if (outcome.failed === true) {
		throw new ApiError(500, 'server_error', outcome.error);
	}
	throw new ApiError(422, 'refused', outcome.error);
}

function bodyOf(used: Tool): z.ZodObject {
	const named = ['base', 'table'].filter((key) => key in used.input.shape);
	const mask: Record<string, true> = Object.fromEntries(named.map((key) => [key, true]));
	return used.input.omit(mask as Parameters<z.ZodObject['omit']>[0]);
}

const ROWS = z.strictObject({ rows: z.array(ROW) });

const KEYS = z
	.enum(['name', 'id'])
	.describe('key the fields of each row by field name (the default) or by field id');

async function rowsByIds(ctx: Context, ws: Workspace, table: string, ids: string[]) {
	const rows = ids.map((id) => ws.get(id)).filter((rec) => rec !== undefined);
	return { rows: await shapeRows(ws, table, rows, sqlTurn(ctx.caller.tokenId)) };
}

const ROWS_PATH = '/bases/{base}/tables/{table}/rows';
const ROW_PATH = `${ROWS_PATH}/{row}`;

export const OPERATIONS: Operation[] = [
	{
		id: 'listBases',
		method: 'GET',
		path: '/bases',
		summary: 'List bases',
		description: LIST_BASES.description,
		access: 'read',
		status: 200,
		response: LIST_BASES.output,
		run: async (ctx) => (await run(ctx, LIST_BASES, {})).result
	},
	{
		id: 'getBase',
		method: 'GET',
		path: '/bases/{base}',
		summary: 'Read the schema of a base',
		description: DESCRIBE_BASE.description,
		access: 'read',
		status: 200,
		response: DESCRIBE_BASE.output,
		run: async (ctx) => {
			const { base } = place(ctx);
			return (await run(ctx, DESCRIBE_BASE, { base })).result;
		}
	},
	{
		id: 'query',
		method: 'POST',
		path: '/bases/{base}/query',
		summary: 'Read with SQL',
		description: QUERY.description,
		access: 'read',
		body: bodyOf(QUERY),
		status: 200,
		response: QUERY.output,
		run: async (ctx) => {
			const { base } = place(ctx);
			return (await run(ctx, QUERY, { ...(ctx.body as object), base })).result;
		}
	},
	{
		id: 'listRows',
		method: 'GET',
		path: ROWS_PATH,
		summary: 'List rows',
		description:
			'The rows of a table in the order they were created, a page at a time. Pass the cursor of a page to read the next one; it is null on the last page. To filter, sort or aggregate, use query.',
		access: 'read',
		query: z.strictObject({
			limit: z.number().int().min(1).max(100).optional().describe('rows per page, 100 by default'),
			cursor: z.string().optional().describe('the cursor of the previous page'),
			fields: z
				.array(z.string())
				.optional()
				.describe('only these fields, by name or id; repeat the parameter for each'),
			keys: KEYS.optional()
		}),
		status: 200,
		response: z.strictObject({
			rows: z.array(ROW),
			cursor: z.union([
				z.string().describe('pass it as cursor to read the next page'),
				z.null().describe('this is the last page')
			])
		}),
		run: async (ctx) => {
			const { ws, table } = place(ctx);
			const query = ctx.query as {
				limit?: number;
				cursor?: string;
				fields?: string[];
				keys?: Keys;
			};
			const position = query.cursor === undefined ? null : readRowCursor(query.cursor);
			if (query.cursor !== undefined && position === null) {
				throw new ApiError(400, 'invalid', 'cursor is not one this API gave');
			}
			const fields =
				query.fields === undefined
					? ws.fields(table)
					: query.fields.map((name) => located(() => findField(ws, table, name)));
			const limit = query.limit ?? 100;
			const rest = after(ws.rows(table), position);
			const page = rest.slice(0, limit);
			return {
				rows: await shapeRows(ws, table, page, sqlTurn(ctx.caller.tokenId), fields, query.keys),
				cursor: rest.length > limit ? rowCursor(page[page.length - 1]) : null
			};
		}
	},
	{
		id: 'createRows',
		method: 'POST',
		path: ROWS_PATH,
		summary: 'Add rows',
		description: `${ADD_ROWS.description} Answers with the rows as stored.`,
		access: 'write',
		body: bodyOf(ADD_ROWS),
		status: 201,
		response: ROWS,
		run: async (ctx) => {
			const { base, table } = place(ctx);
			const { result, ws } = await run(ctx, ADD_ROWS, { ...(ctx.body as object), base, table });
			return rowsByIds(ctx, ws, table, result.added as string[]);
		}
	},
	{
		id: 'updateRows',
		method: 'PATCH',
		path: ROWS_PATH,
		summary: 'Change rows',
		description: `${UPDATE_ROWS.description} Answers with the rows as stored.`,
		access: 'write',
		body: bodyOf(UPDATE_ROWS),
		status: 200,
		response: ROWS,
		run: async (ctx) => {
			const { base, table } = place(ctx);
			const body = ctx.body as { updates: { id: string }[] };
			const { ws } = await run(ctx, UPDATE_ROWS, { ...body, base, table });
			return rowsByIds(ctx, ws, table, [...new Set(body.updates.map((update) => update.id))]);
		}
	},
	{
		id: 'deleteRows',
		method: 'DELETE',
		path: ROWS_PATH,
		summary: 'Delete rows',
		description: DELETE_ROWS.description,
		access: 'write',
		query: z.strictObject({
			ids: z
				.array(z.string())
				.min(1)
				.max(100)
				.describe('the rows to delete; repeat the parameter for each')
		}),
		status: 200,
		response: DELETE_ROWS.output,
		run: async (ctx) => {
			const { base, table } = place(ctx);
			return (await run(ctx, DELETE_ROWS, { base, table, ids: ctx.query.ids })).result;
		}
	},
	{
		id: 'getRow',
		method: 'GET',
		path: ROW_PATH,
		summary: 'Read a row',
		access: 'read',
		query: z.strictObject({ keys: KEYS.optional() }),
		status: 200,
		response: ROW,
		run: async (ctx) => {
			const { ws, table } = place(ctx);
			const rec = liveRow(ws, table, ctx.params.row);
			const [row] = await shapeRows(
				ws,
				table,
				[rec],
				sqlTurn(ctx.caller.tokenId),
				ws.fields(table),
				ctx.query.keys as Keys
			);
			return row;
		}
	},
	{
		id: 'updateRow',
		method: 'PATCH',
		path: ROW_PATH,
		summary: 'Change a row',
		description: 'Changes one row. Only the fields given change. Answers with the row as stored.',
		access: 'write',
		body: ROW_VALUES,
		status: 200,
		response: ROW,
		run: async (ctx) => {
			const { ws: before, base, table } = place(ctx);
			const id = liveRow(before, table, ctx.params.row).id;
			const { ws } = await run(ctx, UPDATE_ROWS, {
				base,
				table,
				updates: [{ id, values: ctx.body }]
			});
			const [row] = (await rowsByIds(ctx, ws, table, [id])).rows;
			return row;
		}
	},
	{
		id: 'deleteRow',
		method: 'DELETE',
		path: ROW_PATH,
		summary: 'Delete a row',
		access: 'write',
		status: 200,
		response: DELETE_ROWS.output,
		run: async (ctx) => {
			const { ws, base, table } = place(ctx);
			const id = liveRow(ws, table, ctx.params.row).id;
			return (await run(ctx, DELETE_ROWS, { base, table, ids: [id] })).result;
		}
	},
	{
		id: 'listChanges',
		method: 'GET',
		path: '/changes',
		summary: 'Read the changes',
		description:
			'What changed in a base since a cursor, oldest first: rows added, changed or deleted, and the tables, fields and views whose schema changed (read the base again for those). Keep the cursor of each answer and pass it as since on the next call; without since, the feed starts from the beginning. A cursor belongs to its base.',
		access: 'read',
		query: CHANGES,
		status: 200,
		response: z.strictObject({
			changes: z.array(
				z.strictObject({
					kind: z.enum(['base', 'table', 'field', 'view', 'row']),
					id: z.string(),
					table: z.string().nullable().describe('the id of the table, for a field, view or row'),
					deleted: z.boolean(),
					row: ROW.optional().describe('the row as it is now, unless deleted')
				})
			),
			cursor: z.string().describe('pass it as since on the next call'),
			more: z.boolean().describe('more changes wait: call again at once with the new cursor')
		}),
		run: (ctx) => readChanges(ctx.db, ctx.caller, ctx.query as z.infer<typeof CHANGES>)
	}
];

const throttled = perMinute(apiCallsPerMinute);

function unwrapped(schema: z.ZodType): z.ZodType {
	let at = schema;
	while (at instanceof z.ZodOptional || at instanceof z.ZodNullable || at instanceof z.ZodDefault) {
		at = at.unwrap() as z.ZodType;
	}
	return at;
}

const NUMBER = /^-?\d+(?:\.\d+)?$/u;

/** The query string as the operation's schema reads it: arrays from repeated keys, numbers from digits. */
function readQuery(schema: z.ZodObject | undefined, params: URLSearchParams): unknown {
	const out: Record<string, unknown> = {};
	for (const key of new Set(params.keys())) {
		const field = schema?.shape[key] as z.ZodType | undefined;
		const inner = field === undefined ? undefined : unwrapped(field);
		const values = params.getAll(key);
		if (inner instanceof z.ZodArray) {
			out[key] = values;
		} else if (values.length > 1) {
			throw new ApiError(400, 'invalid', `${key} appears more than once`);
		} else if (inner instanceof z.ZodNumber && NUMBER.test(values[0])) {
			out[key] = Number(values[0]);
		} else {
			out[key] = values[0];
		}
	}
	return out;
}

async function readBody(request: Request): Promise<unknown> {
	const text = await request.text();
	try {
		return JSON.parse(text);
	} catch {
		throw new ApiError(400, 'invalid', 'the body is not JSON');
	}
}

function parsed<T>(schema: z.ZodType<T>, value: unknown, where: string): T {
	const result = schema.safeParse(value);
	if (!result.success) {
		throw new ApiError(400, 'invalid', `${where}: ${inputProblem(schema, result.error)}`);
	}
	return result.data;
}

/** One operation over HTTP: the credential, its scope and budget, the input, the answer. */
export async function serveOperation(
	op: Operation,
	event: Pick<RequestEvent, 'request' | 'params' | 'url'>,
	credential: Credential,
	db: Database
): Promise<Response> {
	const caller = callerOf(credential);
	try {
		if (op.access === 'write' && caller.access !== 'write') {
			throw new ApiError(
				403,
				'forbidden',
				'this token reads only; a read and write token can change data'
			);
		}
		const wait = throttled(caller.tokenId);
		if (wait !== null) {
			const refused = errorResponse(
				429,
				'rate_limited',
				`this token made more than ${apiCallsPerMinute()} requests in the last minute`
			);
			refused.headers.set('retry-after', String(wait));
			return refused;
		}
		const query = parsed(
			op.query ?? z.strictObject({}),
			readQuery(op.query, event.url.searchParams),
			'query'
		);
		const body =
			op.body === undefined ? undefined : parsed(op.body, await readBody(event.request), 'body');
		const params = event.params as Record<string, string>;
		const result = await op.run({
			db,
			caller,
			params,
			query: query as Record<string, unknown>,
			body
		});
		return json(result, { status: op.status });
	} catch (error) {
		if (error instanceof ApiError) {
			return errorResponse(error.status, error.code, error.message);
		}
		console.error(`${op.id} failed:`, error);
		return errorResponse(500, 'server_error', `${op.id} failed on the server`);
	}
}

export function operation(id: string): Operation {
	const found = OPERATIONS.find((op) => op.id === id);
	if (found === undefined) throw new Error(`no operation ${id}`);
	return found;
}
