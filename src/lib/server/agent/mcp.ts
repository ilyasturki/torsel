import { McpServer } from '@modelcontextprotocol/server';

import type { Database } from '../db/client.ts';
import { loadWorkspace, writeChanges } from '../db/records.ts';
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

	for (const tool of TOOLS) {
		server.registerTool(
			tool.name,
			{
				title: tool.title,
				description: tool.description,
				inputSchema: tool.input,
				annotations: {
					readOnlyHint: tool.readOnly === true,
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
