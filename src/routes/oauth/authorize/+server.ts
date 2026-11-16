import { error } from '@sveltejs/kit';

import { slidingWindow } from '#lib/server/auth/rate-limit.ts';
import { oauthOrigin } from '#lib/server/config.ts';
import { getDatabase } from '#lib/server/db/client.ts';
import { authorize } from '#lib/server/oauth/flow.ts';
import { errors } from '#lib/i18n/errors.ts';

import type { RequestHandler } from './$types';

// Each one can make the server fetch a client's metadata document.
const attempts = slidingWindow(60, 15 * 60 * 1000);

function goTo(location: string): Response {
	return new Response(null, { status: 303, headers: { location, 'cache-control': 'no-store' } });
}

export const GET: RequestHandler = async ({ url, getClientAddress }) => {
	const origin = oauthOrigin(url);
	if (origin === null) {
		error(404);
	}
	if (attempts.hit(getClientAddress())) {
		error(429, errors.tooMany);
	}

	const outcome = await authorize(getDatabase(), url.searchParams, origin);
	switch (outcome.kind) {
		case 'consent':
			return goTo(`/app/authorize?request=${outcome.id}`);
		case 'refuse':
			return goTo(`/app/authorize?error=${outcome.reason}`);
		case 'redirect':
			return goTo(outcome.location);
	}
};
