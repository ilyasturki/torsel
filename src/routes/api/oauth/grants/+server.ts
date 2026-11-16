import { json } from '@sveltejs/kit';

import { getDatabase } from '#lib/server/db/client.ts';
import { requireCredential } from '#lib/server/http/guards.ts';
import { listGrants } from '#lib/server/oauth/flow.ts';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals }) => {
	const { user } = requireCredential(locals);
	return json(listGrants(getDatabase(), user.id));
};
