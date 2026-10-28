import { error, json } from '@sveltejs/kit';

import { isSyncRequest } from '#lib/core/protocol.ts';
import { getDatabase } from '#lib/server/db/client.ts';
import { syncExchange } from '#lib/server/db/records.ts';
import { readJsonBody } from '#lib/server/http/body.ts';
import { requireCredential } from '#lib/server/http/guards.ts';

import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	const { user } = requireCredential(locals);

	const body = await readJsonBody(request);
	if (!isSyncRequest(body)) {
		error(400, 'expected { watermark, push } with well-formed records');
	}

	return json(syncExchange(getDatabase(), user.id, body));
};
