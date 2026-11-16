import type {
	AuthInfo,
	CallToolResult,
	JsonSchemaType,
	JsonSchemaValidator,
	McpHttpHandler,
	StandardSchemaWithJSON,
	jsonSchemaValidator
} from '@modelcontextprotocol/server';
import {
	McpServer,
	createMcpHandler,
	fromJsonSchema,
	localhostAllowedOrigins,
	originValidationResponse
} from '@modelcontextprotocol/server';
import { z } from 'zod';

import type { Actor, Path } from '../../core/access.ts';
import { Hlc } from '../../core/clock.ts';
import { stampAll } from '../../core/diff.ts';
import type { ImageRef } from '../../core/images.ts';
import type { Workspace } from '../../core/workspace.ts';
import type { Database } from '../db/client.ts';
import { loadWorkspace, writeUndoable } from '../db/records.ts';
import { serially } from '../db/serial.ts';
import type { ImageHost } from '../images/host.ts';
import { imageHost } from '../images/host.ts';
import { IngestFailed, ingestAll } from '../images/ingest.ts';
import { sourceHost } from '../sources/host.ts';
import { perMinute } from '../auth/rate-limit.ts';
import type { Credential } from '../auth/session.ts';
import { allowedOrigins, mcpCallsPerMinute, siteOrigin } from '../config.ts';
import { recordToolChange } from './threads.ts';
import type { Tool, ToolContext } from './toolkit.ts';
import { TOOLS, runTool } from './toolkit.ts';

export const INSTRUCTIONS = `Torsel holds a person's data as bases of typed tables shown through views (grid, entry, list, chart). Table names are unique in a base, field names in a table; ids work wherever a name does.

Read describe_base before writing: names, types and choices come from there. Read data with query, a read-only SQLite SELECT over views named like the tables and fields. Every write applies at once on the server and reaches the person's devices at their next sync; what they typed on a device in the last minute may not show here yet. The person sees each write in the app, in a conversation named after this token, and can undo it there; still resolve what you mean before you change or delete it. A refused call says what to change; nothing of it was written.`;

const READ_ONLY = `This token reads only: the tools that change data are not here. A read and write token, from Settings, Agents (MCP), can change data.`;

/** Who calls: the account, the credential that reached the endpoint, and what that credential may do. */
export type McpCaller = {
	userId: string;
	tokenId: string;
	label: string;
	access: 'read' | 'write';
};

// No screen here to show a table on, and no attachment to import.
const SERVED = TOOLS.filter((tool) => tool.kind !== 'screen' && tool.name !== 'import_file');

export function callerOf({ user, token }: Credential): McpCaller {
	return {
		userId: user.id,
		// A connected app's access token changes hourly: its call budget and its conversation follow the grant.
		tokenId: token.grantId ?? token.id,
		label: token.label,
		access: token.kind === 'web' || token.kind === 'device' ? 'write' : token.access
	};
}

export function sqlTurn(tokenId: string): string {
	return `query:${tokenId}`;
}

const overLimit = perMinute(mcpCallsPerMinute);

type Outcome = Awaited<ReturnType<typeof runTool>>;

async function call(db: Database, caller: McpCaller, tool: Tool, input: unknown): Promise<Outcome> {
	if ((tool.kind !== 'read' || tool.openWorld === true) && caller.access !== 'write') {
		return { ok: false, error: READ_ONLY };
	}
	if (overLimit(caller.tokenId) !== null) {
		const limit = mcpCallsPerMinute();
		return {
			ok: false,
			error: `this token made more than ${limit} calls in the last minute; wait a few seconds and call again`
		};
	}

	return (await execute(db, caller, tool, input, 'mcp')).outcome;
}

/** Image links answered from what was fetched before the turn: a link not fetched yet is noted and refused as busy. */
function fetchedFirst(host: ImageHost): {
	host: ImageHost;
	missed(): boolean;
	fetchMissed(): Promise<void>;
} {
	const got = new Map<string, ImageRef | IngestFailed>();
	const missed = new Map<string, { baseId: string; url: string }>();
	return {
		host: {
			...host,
			fromUrl(baseId, url) {
				const key = JSON.stringify([baseId, url]);
				const known = got.get(key);
				if (known === undefined) {
					missed.set(key, { baseId, url });
					return Promise.reject(new IngestFailed('busy'));
				}
				return known instanceof IngestFailed ? Promise.reject(known) : Promise.resolve(known);
			}
		},
		missed: () => missed.size > 0,
		async fetchMissed() {
			const wanted = new Map(missed);
			missed.clear();
			const fetched = await ingestAll([...wanted.keys()], (key) => {
				const { baseId, url } = wanted.get(key) as { baseId: string; url: string };
				return host.fromUrl(baseId, url);
			});
			for (const [key, result] of fetched) got.set(key, result);
		}
	};
}

// A workspace changed between passes can name new links; past this many passes the call answers busy.
const FETCH_PASSES = 3;

/** Runs a tool for a credential outside the app; the workspace it ran on, writes included. */
export async function execute(
	db: Database,
	caller: McpCaller,
	tool: Tool,
	input: unknown,
	path: Path
): Promise<{ outcome: Outcome; ws: Workspace }> {
	const inTurn = tool.kind !== 'read' && tool.openWorld !== true;
	const images = fetchedFirst(imageHost(db, caller.userId));
	const work = async () => {
		const ws = loadWorkspace(db, caller.userId);
		const actor: Actor = { user: caller.userId, path };
		const ctx: ToolContext = {
			ws,
			actor,
			commit(action) {
				if (action.applied !== true && !inTurn) {
					throw new Error(`${tool.name} runs outside the account turn: only its host writes`);
				}
				if (images.missed()) {
					throw new Error(`${tool.name} wrote before its image links were fetched`);
				}
				// A linked table is already written by the server: only its card is recorded.
				const before =
					action.applied === true
						? stampAll(ws, new Hlc('mcp'), action.changes)
						: writeUndoable(db, actor, ws, action.changes);
				try {
					recordToolChange(
						db,
						caller.userId,
						{ id: caller.tokenId, label: caller.label },
						{ name: tool.name, input },
						{ summary: action.summary, changes: action.changes, before }
					);
				} catch (thrown) {
					// The write stands; only its card in the app is missing.
					console.error('mcp change record:', thrown instanceof Error ? thrown.message : thrown);
				}
			},
			sources: sourceHost(db, caller.userId),
			images: images.host
		};
		return { outcome: await runTool(ctx, tool, input), ws };
	};
	// Writes load and commit inside the account's turn, so no call overwrites what another just wrote;
	// the image links a write names are fetched between turns, then it runs again, so a slow site never stalls the account;
	// an open-world tool takes the turn only around its own writes;
	// a token's queries take turns, so one token never holds every SQL worker.
	if (inTurn) {
		for (let pass = 1; ; pass += 1) {
			const done = await serially(caller.userId, work);
			if (!images.missed() || pass === FETCH_PASSES) return done;
			await images.fetchMissed();
		}
	}
	return tool.name === 'query' ? serially(sqlTurn(caller.tokenId), work) : work();
}

// The toolkit validates input itself, to answer in the one error shape: the SDK only lists the schema.
const ACCEPT_ALL: jsonSchemaValidator = {
	getValidator<T>(): JsonSchemaValidator<T> {
		return (input) => ({ valid: true, data: input as T, errorMessage: undefined });
	}
};

function listedOnly(schema: Tool['input']): StandardSchemaWithJSON {
	const json = z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' });
	return fromJsonSchema(json as JsonSchemaType, ACCEPT_ALL);
}

export function buildMcpServer(db: Database, caller: McpCaller, version: string): McpServer {
	const server = new McpServer(
		{ name: 'torsel', version },
		{
			instructions: caller.access === 'write' ? INSTRUCTIONS : `${INSTRUCTIONS}\n\n${READ_ONLY}`,
			capabilities: { tools: { listChanged: false } }
		}
	);

	for (const tool of SERVED.filter(
		(served) => (served.kind === 'read' && served.openWorld !== true) || caller.access === 'write'
	)) {
		server.registerTool(
			tool.name,
			{
				title: tool.title,
				description: tool.description,
				inputSchema: listedOnly(tool.input),
				outputSchema: tool.output,
				annotations: {
					readOnlyHint: tool.kind === 'read',
					destructiveHint: tool.destructive,
					idempotentHint: tool.idempotent,
					openWorldHint: tool.openWorld === true
				}
			},
			async (input: unknown): Promise<CallToolResult> => {
				const outcome = await call(db, caller, tool, input);
				if (!outcome.ok) {
					return { content: [{ type: 'text', text: outcome.error }], isError: true };
				}
				return {
					content: [{ type: 'text', text: JSON.stringify(outcome.result) }],
					structuredContent: outcome.result
				};
			}
		);
	}

	return server;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** This server's own site and the configured CORS origins; a local server also takes local pages. */
function allowedHostnames(url: URL): string[] {
	const own = new URL(siteOrigin(url) ?? url.origin).hostname;
	const hostnames = [own, ...allowedOrigins().map((origin) => new URL(origin).hostname)];
	return LOOPBACK.has(own) ? [...hostnames, ...localhostAllowedOrigins()] : hostnames;
}

const handlers = new WeakMap<Database, McpHttpHandler>();

function handlerFor(db: Database, version: string): McpHttpHandler {
	let handler = handlers.get(db);
	if (handler === undefined) {
		handler = createMcpHandler(
			({ authInfo }) => buildMcpServer(db, authInfo?.extra as McpCaller, version),
			{ responseMode: 'json' }
		);
		handlers.set(db, handler);
	}
	return handler;
}

// Stateless in both eras: one server per request, so a restart between two calls loses nothing.
export async function serveMcp(
	db: Database,
	caller: McpCaller,
	request: Request,
	version: string
): Promise<Response> {
	const refused = originValidationResponse(request, allowedHostnames(new URL(request.url)));
	if (refused !== undefined) {
		return refused;
	}

	const authInfo: AuthInfo = {
		token: caller.tokenId,
		clientId: caller.tokenId,
		scopes: [],
		extra: caller
	};
	return handlerFor(db, version).fetch(request, { authInfo });
}
