import { error } from '@sveltejs/kit';

import { getDatabase } from '#lib/server/db/client.ts';
import { requireCredential } from '#lib/server/http/guards.ts';
import { revokeGrant } from '#lib/server/oauth/flow.ts';
import { errors } from '#lib/i18n/errors.ts';

import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = ({ locals, params }) => {
	const { user } = requireCredential(locals);
	if (!revokeGrant(getDatabase(), user.id, params.id)) {
		error(404, errors.noSuchCredential);
	}
	return new Response(null, { status: 204 });
};
