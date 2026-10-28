import { revokeToken } from '#lib/server/auth/accounts.ts';
import { SESSION_COOKIE } from '#lib/server/auth/session.ts';
import { getDatabase } from '#lib/server/db/client.ts';
import { requireCredential } from '#lib/server/http/guards.ts';

import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ locals, cookies }) => {
	const { user, token } = requireCredential(locals);

	revokeToken(getDatabase(), user.id, token.id);
	cookies.delete(SESSION_COOKIE, { path: '/' });

	return new Response(null, { status: 204 });
};
