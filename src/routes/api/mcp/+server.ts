import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';

import { buildMcpServer } from '#lib/server/agent/mcp.ts';
import { getDatabase } from '#lib/server/db/client.ts';
import { requireCredential } from '#lib/server/http/guards.ts';

import type { RequestHandler } from './$types';

// Stateless: one server per request, so a restart between two calls loses nothing.
export const POST: RequestHandler = async ({ request, locals }) => {
	const { user } = requireCredential(locals);

	const { server, release } = buildMcpServer(getDatabase(), user.id, import.meta.env.APP_VERSION);
	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true
	});

	await server.connect(transport);

	try {
		return await transport.handleRequest(request);
	} finally {
		await server.close();
		release();
	}
};
