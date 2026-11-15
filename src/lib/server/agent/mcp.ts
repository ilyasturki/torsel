import type {
	AuthInfo,
	CallToolResult,
	McpHttpHandler,
	StandardSchemaWithJSON
} from '@modelcontextprotocol/server';
import {
	McpServer,
	createMcpHandler,
	localhostAllowedOrigins,
	originValidationResponse
} from '@modelcontextprotocol/server';

import type { Database } from '../db/client.ts';
import { loadWorkspace, writeChanges } from '../db/records.ts';
import { serially } from '../db/serial.ts';
import { allowedOrigins, siteOrigin } from '../config.ts';
import type { Tool, ToolContext } from './toolkit.ts';
import { TOOLS, runTool } from './toolkit.ts';

export const INSTRUCTIONS = `Torsel holds a person's data as bases of typed tables shown through views (grid, entry, list, chart). Table names are unique in a base, field names in a table; ids work wherever a name does.

Read describe_base before writing: names, types and choices come from there. Read data with query, a read-only SQLite SELECT over views named like the tables and fields. Every write applies at once on the server and reaches the person's devices at their next sync; what they typed on a device in the last minute may not show here yet. Nothing written here can be undone from the app, so resolve what you mean before you change or delete it. A refused call says what to change; nothing of it was written.`;

/** Who calls: the account, and the credential that reached the endpoint. */
export type McpCaller = { userId: string; tokenId: string };

// No screen here to show a table on, and no attachment to import.
const SERVED = TOOLS.filter((tool) => tool.kind !== 'screen' && tool.name !== 'import_file');

async function call(db: Database, caller: McpCaller, tool: Tool, input: unknown) {
	const work = async () => {
		const ws = loadWorkspace(db, caller.userId);
		const ctx: ToolContext = {
			ws,
			commit(action) {
				writeChanges(db, caller.userId, ws, action.changes);
			}
		};
		return runTool(ctx, tool, input);
	};
	// Writes load and commit inside the account's turn, so no call overwrites what another just wrote.
	return tool.kind === 'read' ? work() : serially(caller.userId, work);
}

// The toolkit validates input itself, to answer in the one error shape: the SDK only lists the schema.
function listedOnly(schema: Tool['input']): StandardSchemaWithJSON {
	const standard = schema['~standard'] as StandardSchemaWithJSON['~standard'];
	return { '~standard': { ...standard, validate: (value: unknown) => ({ value }) } };
}

export function buildMcpServer(db: Database, caller: McpCaller, version: string): McpServer {
	const server = new McpServer(
		{ name: 'torsel', version },
		{ instructions: INSTRUCTIONS, capabilities: { tools: { listChanged: false } } }
	);

	for (const tool of SERVED) {
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
					openWorldHint: false
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
