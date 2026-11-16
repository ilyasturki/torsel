import { getDatabase } from '#lib/server/db/client.ts';
import { requireCredential } from '#lib/server/http/guards.ts';
import { forget } from '#lib/server/publish/serve.ts';
import { unpublish } from '#lib/server/publish/store.ts';

import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = ({ locals, params }) => {
	const { user } = requireCredential(locals);
	const token = unpublish(getDatabase(), user.id, params.view);
	if (token !== undefined) forget(token);
	return new Response(null, { status: 204 });
};
