import { serveMcp } from '#lib/server/agent/mcp.ts';
import { getDatabase } from '#lib/server/db/client.ts';
import { requireCredential } from '#lib/server/http/guards.ts';

import type { RequestHandler } from './$types';

// GET and DELETE reach the handler too: it answers both with 405, as a stateless server must.
const serve: RequestHandler = ({ request, locals }) => {
	const { user, token } = requireCredential(locals);

	return serveMcp(
		getDatabase(),
		{
			userId: user.id,
			// A connected app's access token changes hourly: its call budget follows the grant.
			tokenId: token.grantId ?? token.id,
			access: token.kind === 'web' || token.kind === 'device' ? 'write' : token.access
		},
		request,
		import.meta.env.APP_VERSION
	);
};

export const POST = serve;
export const GET = serve;
export const DELETE = serve;
