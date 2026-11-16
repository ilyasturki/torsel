import { z } from 'zod';

import { PRESETS, presetSource } from '../../core/presets.ts';
import type { PresetId } from '../../core/presets.ts';
import type { Change, TableDef } from '../../core/model.ts';
import { FIELD_TYPES } from '../../core/model.ts';
import type { Column, Every, Missing } from '../../core/source.ts';
import { EVERY, MISSING, sourceMark, sourceName } from '../../core/source.ts';
import type { Workspace } from '../../core/workspace.ts';
import { sources as words } from '../../i18n/sources.ts';
import type { Auth, AuthKind } from '../sources/fetch.ts';
import { AUTH_KINDS } from '../sources/fetch.ts';
import type { Tool, ToolContext } from './toolkit.ts';

export type SourcePreview = {
	format: string;
	url: string;
	columns: Column[];
	items: Record<string, string>[];
	count: number;
	more: boolean;
	rowPaths: string[];
	rows: string;
	key: string | null;
};

export type SourceRequest = {
	base: string | null;
	name: string;
	label: string;
	url: string;
	auth: Auth;
	rows: string | null;
	key: string | null;
	filter: string | null;
	every: Every;
	missing: Missing;
	columns: Column[];
};

export type RunResult =
	| { ok: true; added: number; changed: number; removed: number; problem: string | null }
	| { ok: false; problem: string };

/** What the server does for the tools that link tables: fetch, create, run. Never handed a key. */
export type SourceHost = {
	preview(input: { url: string; auth: Auth; rows: string | null }): Promise<SourcePreview>;
	connect(
		request: SourceRequest
	): Promise<{ table: string; base: string; changes: Change[]; run: RunResult }>;
	refresh(table: string): Promise<RunResult>;
	update(table: string, patch: { every?: Every; missing?: Missing }): void;
	stop(table: string): Promise<void>;
};

/** A failure the host reports by its code: what the model is told it means. */
export class SourceFailure extends Error {
	constructor(readonly code: string) {
		super(code);
		this.name = 'SourceFailure';
	}
}

const PROBLEMS: Record<string, string> = {
	scheme: 'not an http(s) link',
	url: 'not an http(s) link',
	address: 'the link points at a private or local address, which the server never fetches',
	timeout: 'the link took too long to answer',
	network: 'the link could not be reached',
	size: 'the answer is over 10 MB',
	auth: 'the link refused the request: it needs a key',
	missing: 'the link answered 404 or 410',
	status: 'the link answered with an error',
	limit: 'the link is rate limiting; try later',
	redirects: 'the link redirects too many times',
	html: 'the link is a web page, not data: read it with web_fetch to find the URL that returns data',
	format: 'the answer is not CSV, TSV, JSON, Excel, RSS or Atom',
	rows: 'no rows at that path; read_source lists the paths that hold rows',
	cap: 'the link holds more rows or pages than a table takes: the first ones came in',
	empty: 'the link answered with no rows; the table keeps the ones it had',
	columns: 'fields needs at least one column',
	count: 'the account has as many linked tables as it may keep',
	base: 'no such base',
	gone: 'that table has no source'
};

export function problemText(code: string): string {
	return PROBLEMS[code] ?? code;
}

const AUTH = z
	.strictObject({
		kind: z.enum(AUTH_KINDS),
		name: z
			.string()
			.optional()
			.describe('the header (kind header) or query parameter (kind query) that carries the key')
	})
	.describe('how the link signs in; the key itself is never given here');

const LINK = {
	url: z.string().optional().describe('the http(s) link that returns the data'),
	preset: z
		.enum(PRESETS)
		.optional()
		.describe(
			'instead of url: letterboxd (value: the member name), sheet (value: a Google Sheets link), github (value: owner/repo, its issues)'
		),
	value: z.string().optional().describe('what the preset asks for')
};

type LinkInput = { url?: string; preset?: PresetId; value?: string };

const COLUMN_OUT = z.strictObject({
	path: z.string(),
	name: z.string(),
	type: z.enum(FIELD_TYPES),
	values: z.array(z.string())
});

function linkOf(input: LinkInput, fail: (message: string) => never) {
	if (input.preset !== undefined) {
		const preset = presetSource(input.preset, input.value ?? '', words);
		if (preset === null) fail(`${input.preset} can’t read "${input.value ?? ''}"`);
		return { url: preset.url, preset };
	}
	if (input.url === undefined || input.url.trim() === '') fail('give url, or preset and value');
	return { url: input.url.trim(), preset: null };
}

function authOf(input: { kind: AuthKind; name?: string } | undefined): Auth {
	return input === undefined
		? { kind: 'none', name: null }
		: { kind: input.kind, name: input.name ?? null };
}

function sourceTable(ws: Workspace, ref: string, fail: (message: string) => never): TableDef {
	const tables = ws.bases().flatMap((base) => ws.tables(base.id));
	const found = tables.filter(
		(table) => table.id === ref || table.name.toLowerCase() === ref.trim().toLowerCase()
	);
	const linked = found.filter((table) => sourceMark(ws.get(table.id)) !== null);
	if (linked.length === 1) return linked[0];
	if (linked.length > 1) fail(`several linked tables are named "${ref}": give the id`);
	const all = tables
		.filter((table) => sourceMark(ws.get(table.id)) !== null)
		.map((table) => `"${table.name}"`);
	return fail(
		found.length > 0
			? `"${ref}" is not linked to a source`
			: `no linked table "${ref}"; the linked tables are ${all.join(', ') || 'none'}`
	);
}

function host(ctx: ToolContext, fail: (message: string) => never): SourceHost {
	return ctx.sources ?? fail('linked tables are not available here');
}

async function hosted<T>(work: () => Promise<T>, fail: (message: string) => never): Promise<T> {
	try {
		return await work();
	} catch (error) {
		if (error instanceof SourceFailure) fail(problemText(error.code));
		throw error;
	}
}

/** The tools that link a table to a source; `fail` throws the toolkit's ToolError. */
export function sourceTools(fail: (message: string) => never): Tool[] {
	return [
		{
			name: 'read_source',
			title: 'Read a link',
			description:
				'Reads a link as a linked table would: CSV, TSV, JSON, Excel, RSS or Atom over http(s), its first page. Returns the format, each column (path, a field name, a guessed type, its first values), the rows on the page, whether more pages follow, the paths that hold rows in a JSON answer, and the key path that tells rows apart. needs_key is true when the link refused without a key. For an API, read its docs with web_fetch first to find the URL that returns data.',
			input: z.strictObject({
				...LINK,
				rows: z
					.string()
					.optional()
					.describe(
						'in a JSON answer, the dotted path to the rows; the longest list is the default'
					),
				auth: AUTH.optional()
			}),
			output: z.strictObject({
				format: z.string().optional(),
				url: z.string().optional(),
				columns: z.array(COLUMN_OUT).optional(),
				rows_on_page: z.number().optional(),
				more_pages: z.boolean().optional(),
				row_paths: z.array(z.string()).optional(),
				rows: z.string().optional(),
				key: z
					.string()
					.optional()
					.describe(
						'absent when no path tells rows apart: each row is then known by all its values'
					),
				needs_key: z.boolean().optional()
			}),
			kind: 'read',
			destructive: false,
			idempotent: true,
			openWorld: true,
			run: async (
				ctx,
				input: LinkInput & { rows?: string; auth?: { kind: AuthKind; name?: string } }
			) => {
				const sources = host(ctx, fail);
				const link = linkOf(input, fail);
				try {
					const preview = await sources.preview({
						url: link.url,
						auth: authOf(input.auth),
						rows: input.rows ?? null
					});
					const columns = link.preset?.columns ?? preview.columns;
					const key = link.preset?.key ?? preview.key;
					return {
						format: preview.format,
						url: preview.url,
						columns: columns.map((column) => ({
							path: column.path,
							name: column.name,
							type: column.type,
							values: preview.items
								.map((item) => item[column.path] ?? '')
								.filter((value) => value !== '')
								.slice(0, 3)
								.map((value) => value.slice(0, 200))
						})),
						rows_on_page: preview.count,
						more_pages: preview.more,
						row_paths: preview.rowPaths,
						rows: preview.rows,
						...(key === null ? {} : { key })
					};
				} catch (error) {
					if (error instanceof SourceFailure && error.code === 'auth') return { needs_key: true };
					if (error instanceof SourceFailure) fail(problemText(error.code));
					throw error;
				}
			}
		},
		{
			name: 'connect_source',
			title: 'Link a table to a source',
			description:
				'Makes a new table that fills itself from a link, refreshed by the server: its linked fields are read-only, and the person can add fields of their own beside them. Read the link with read_source first. fields picks, names and types the columns, from being a path read_source gave; left out, every column comes. For a link that needs a key, give auth with its kind and, for a header or query key, its name: the key itself never goes through the conversation, the person types it in the change card. every: hour (default), day or manual. missing, for rows gone from the link: remove (the default) or keep (the default for feeds, which show their latest items only).',
			input: z.strictObject({
				...LINK,
				name: z.string().optional().describe('the new table; the source’s name by default'),
				base: z
					.string()
					.optional()
					.describe('name or id of the base; the default base when left out'),
				auth: AUTH.optional(),
				rows: z.string().optional().describe('in a JSON answer, the dotted path to the rows'),
				key: z
					.string()
					.optional()
					.describe('the path whose values tell rows apart; read_source suggests one'),
				fields: z
					.array(
						z.strictObject({
							from: z.string().describe('the path the values come from'),
							name: z.string(),
							type: z.enum(FIELD_TYPES.filter((type) => type !== 'link' && type !== 'formula'))
						})
					)
					.optional(),
				every: z.enum(EVERY).optional(),
				missing: z.enum(MISSING).optional()
			}),
			output: z.strictObject({
				id: z.string(),
				base: z.string(),
				rows: z.number(),
				needs_key: z.boolean(),
				problem: z.string().optional()
			}),
			kind: 'write',
			destructive: false,
			idempotent: false,
			openWorld: true,
			run: async (
				ctx,
				input: LinkInput & {
					name?: string;
					base?: string;
					auth?: { kind: AuthKind; name?: string };
					rows?: string;
					key?: string;
					fields?: { from: string; name: string; type: Column['type'] }[];
					every?: Every;
					missing?: Missing;
				}
			) => {
				const sources = host(ctx, fail);
				const link = linkOf(input, fail);
				const auth = authOf(input.auth);
				let base: string | null = null;
				if (input.base !== undefined) {
					const ref = input.base.trim().toLowerCase();
					const found = ctx.ws
						.bases()
						.find((item) => item.id === input.base || item.name.toLowerCase() === ref);
					if (found === undefined) fail(`no base "${input.base}"`);
					base = found.id;
				}
				let columns: Column[] | undefined =
					input.fields?.map((field) => ({
						path: field.from,
						name: field.name,
						type: field.type
					})) ??
					link.preset?.columns ??
					undefined;
				let key = input.key ?? link.preset?.key ?? null;
				let feed = false;
				if (columns === undefined || (input.key === undefined && link.preset === null)) {
					if (auth.kind !== 'none') {
						if (columns === undefined) {
							fail(
								'the link needs a key, so its columns can’t be read here: give fields and key from its docs'
							);
						}
					} else {
						const preview = await hosted(
							() => sources.preview({ url: link.url, auth, rows: input.rows ?? null }),
							fail
						);
						columns ??= preview.columns;
						key = input.key ?? preview.key;
						feed = preview.format === 'rss' || preview.format === 'atom';
					}
				}
				if (columns === undefined || columns.length === 0) fail(problemText('columns'));
				const label = link.preset?.label ?? sourceName(link.url);
				const made = await hosted(
					() =>
						sources.connect({
							base,
							name: input.name ?? link.preset?.name ?? label,
							label,
							url: link.url,
							auth,
							rows: input.rows ?? null,
							key,
							filter: link.preset?.filter ?? null,
							every: input.every ?? link.preset?.every ?? 'hour',
							missing: input.missing ?? link.preset?.missing ?? (feed ? 'keep' : 'remove'),
							columns
						}),
					fail
				);
				const table = made.changes.find((change) => change.id === made.table);
				const name = typeof table?.set.name === 'string' ? table.set.name : label;
				ctx.commit({ summary: words.connected(name, label), changes: made.changes, applied: true });
				const needsKey = auth.kind !== 'none';
				return {
					id: made.table,
					base: made.base,
					rows: made.run.ok ? made.run.added : 0,
					needs_key: needsKey,
					...(made.run.ok
						? made.run.problem === null
							? {}
							: { problem: problemText(made.run.problem) }
						: needsKey && made.run.problem === 'auth'
							? {}
							: { problem: problemText(made.run.problem) })
				};
			}
		},
		{
			name: 'refresh_source',
			title: 'Refresh a linked table',
			description: 'Reads a linked table’s source now, as the server does on its schedule.',
			input: z.strictObject({ table: z.string().describe('name or id of the linked table') }),
			output: z.strictObject({
				added: z.number().optional(),
				changed: z.number().optional(),
				removed: z.number().optional(),
				problem: z.string().optional()
			}),
			kind: 'write',
			destructive: true,
			idempotent: true,
			openWorld: true,
			run: async (ctx, input: { table: string }) => {
				const table = sourceTable(ctx.ws, input.table, fail);
				const run = await hosted(() => host(ctx, fail).refresh(table.id), fail);
				if (!run.ok) return { problem: problemText(run.problem) };
				const { added, changed, removed } = run;
				return {
					added,
					changed,
					removed,
					...(run.problem === null ? {} : { problem: problemText(run.problem) })
				};
			}
		},
		{
			name: 'update_source',
			title: 'Change a linked table’s source',
			description:
				'Changes how often a linked table refreshes (every) and what becomes of rows gone from the source (missing); stop: true stops syncing, which keeps the rows and makes every field editable, and cannot be undone.',
			input: z.strictObject({
				table: z.string().describe('name or id of the linked table'),
				every: z.enum(EVERY).optional(),
				missing: z.enum(MISSING).optional(),
				stop: z.boolean().optional()
			}),
			output: z.strictObject({ updated: z.string() }),
			kind: 'write',
			destructive: true,
			idempotent: true,
			run: async (
				ctx,
				input: { table: string; every?: Every; missing?: Missing; stop?: boolean }
			) => {
				const table = sourceTable(ctx.ws, input.table, fail);
				const sources = host(ctx, fail);
				if (input.stop === true) {
					await hosted(() => sources.stop(table.id), fail);
				} else {
					await hosted(
						async () => sources.update(table.id, { every: input.every, missing: input.missing }),
						fail
					);
				}
				return { updated: table.id };
			}
		}
	];
}
