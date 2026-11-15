import {
	McpServer,
	WebStandardStreamableHTTPServerTransport,
	readRequestBody
} from '@modelcontextprotocol/server';

import type { Database } from '../db/client.ts';
import { loadWorkspace, writeChanges } from '../db/records.ts';
import { serially } from '../db/serial.ts';
import type { ToolContext } from './toolkit.ts';
import { TOOLS, closeEngines, runTool } from './toolkit.ts';

export const INSTRUCTIONS = `Torsel holds a person's data as bases of typed tables (fields: text, number, date, choice, check, link, formula) shown through views (grid, entry, list, chart).

Read describe_base before writing: names, types and choices come from there. Read data with query, a read-only SQLite SELECT over views named like the tables and fields. Every write here applies at once on the server and reaches the person's devices at their next sync; delete has no undo here, so resolve what you mean before you remove it.`;

export function buildMcpServer(
	db: Database,
	userId: string,
	version: string
): {
	server: McpServer;
	release(): void;
} {
	const server = new McpServer(
		{ name: 'torsel', version },
		{ instructions: INSTRUCTIONS, capabilities: { tools: {} } }
	);

	const ws = loadWorkspace(db, userId);
	const ctx: ToolContext = {
		ws,
		commit(action) {
			writeChanges(db, userId, ws, action.changes);
		}
	};

	// No screen here to show a table on, and no attachment to import.
	for (const tool of TOOLS.filter(
		(candidate) => candidate.kind !== 'screen' && candidate.name !== 'import_file'
	)) {
		server.registerTool(
			tool.name,
			{
				title: tool.title,
				description: tool.description,
				inputSchema: tool.input,
				annotations: {
					readOnlyHint: tool.kind === 'read',
					destructiveHint: tool.destructive === true
				}
			},
			async (input: unknown) => {
				const outcome = await runTool(ctx, tool, input);
				const text = JSON.stringify(outcome.ok ? outcome.result : { error: outcome.error });
				return { content: [{ type: 'text' as const, text }], isError: !outcome.ok };
			}
		);
	}

	return { server, release: () => closeEngines(ws) };
}

async function readBody(request: Request): Promise<{ request: Request; parsed?: unknown } | null> {
	const body = await readRequestBody(request);
	if (body.tooLarge) {
		return null;
	}
	const { text } = body;
	const copy = new Request(request.url, {
		method: request.method,
		headers: request.headers,
		body: text
	});
	try {
		return { request: copy, parsed: JSON.parse(text) };
	} catch {
		return { request: copy };
	}
}

// Stateless: one server per request, so a restart between two calls loses nothing. The body is
// read before the account's turn, so a slow upload holds no one else's writes.
export async function serveMcp(
	db: Database,
	userId: string,
	request: Request,
	version: string
): Promise<Response> {
	const body = await readBody(request);
	if (body === null) {
		return Response.json(
			{ jsonrpc: '2.0', error: { code: -32000, message: 'Payload Too Large' }, id: null },
			{ status: 413 }
		);
	}

	return serially(userId, async () => {
		const { server, release } = buildMcpServer(db, userId, version);
		const transport = new WebStandardStreamableHTTPServerTransport({
			sessionIdGenerator: undefined,
			enableJsonResponse: true
		});

		await server.connect(transport);

		try {
			return await transport.handleRequest(
				body.request,
				'parsed' in body ? { parsedBody: body.parsed } : undefined
			);
		} finally {
			await server.close();
			release();
		}
	});
}
