import { error } from '@sveltejs/kit';

import { revokeToken } from '#lib/server/auth/accounts.ts';
import { SESSION_COOKIE } from '#lib/server/auth/session.ts';
import { getDatabase } from '#lib/server/db/client.ts';
import { requireCredential } from '#lib/server/http/guards.ts';

import type { RequestHandler } from './$types';
import { errors } from '#lib/i18n/errors.ts';

export const DELETE: RequestHandler = ({ locals, params, cookies }) => {
	const { user, token } = requireCredential(locals);

	if (!revokeToken(getDatabase(), user.id, params.id)) {
		error(404, errors.noSuchCredential);
	}

	if (params.id === token.id) {
		cookies.delete(SESSION_COOKIE, { path: '/' });
	}

	return new Response(null, { status: 204 });
};
