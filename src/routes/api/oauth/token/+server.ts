import { error } from '@sveltejs/kit';

import { oauthOrigin } from '#lib/server/config.ts';
import { getDatabase } from '#lib/server/db/client.ts';
import { exchange } from '#lib/server/oauth/flow.ts';
import { NOT_A_FORM, readForm, tokenResponse } from '#lib/server/oauth/http.ts';

import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, url }) => {
	if (oauthOrigin(url) === null) {
		error(404);
	}
	const form = await readForm(request);
	return tokenResponse(form === null ? NOT_A_FORM : exchange(getDatabase(), form));
};
