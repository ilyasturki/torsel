import { serveMcp } from '#lib/server/agent/mcp.ts';
import { getDatabase } from '#lib/server/db/client.ts';
import { requireCredential } from '#lib/server/http/guards.ts';

import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ request, locals }) => {
	const { user } = requireCredential(locals);

	return serveMcp(getDatabase(), user.id, request, import.meta.env.APP_VERSION);
};
