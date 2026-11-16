import { error, json } from '@sveltejs/kit';

import { publish as words } from '#lib/i18n/publish.ts';
import { PUBLISHED, enforcePublished } from '#lib/server/auth/rate-limit.ts';
import { getDatabase } from '#lib/server/db/client.ts';
import { readJsonBody } from '#lib/server/http/body.ts';
import { served } from '#lib/server/publish/serve.ts';

import type { RequestHandler } from './$types';

/** A published view as its link shows it; a session, if the visitor has one, changes nothing. */
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	enforcePublished(PUBLISHED.page, getClientAddress());
	const body = await readJsonBody(request);
	const found = typeof body.token === 'string' ? await served(getDatabase(), body.token) : null;
	if (found === null) {
		error(404, words.noSuchLink);
	}
	return json(found.published, {
		headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' }
	});
};
