import { error, json } from '@sveltejs/kit';

import { slidingWindow } from '#lib/server/auth/rate-limit.ts';
import { oauthOrigin } from '#lib/server/config.ts';
import { getDatabase } from '#lib/server/db/client.ts';
import { jsonObject } from '#lib/server/json.ts';
import { registerClient } from '#lib/server/oauth/clients.ts';

import type { RequestHandler } from './$types';

const registrations = slidingWindow(20, 60 * 60 * 1000);

export const POST: RequestHandler = async ({ request, url, getClientAddress }) => {
	if (oauthOrigin(url) === null) {
		error(404);
	}
	if (registrations.hit(getClientAddress())) {
		return json(
			{ error: 'invalid_request', error_description: 'too many registrations, try later' },
			{ status: 429 }
		);
	}
	const body = await jsonObject(request);
	if (body === undefined) {
		return json(
			{ error: 'invalid_client_metadata', error_description: 'the body must be a JSON object' },
			{ status: 400 }
		);
	}
	const registration = registerClient(getDatabase(), body);
	if (!registration.ok) {
		return json(
			{ error: registration.error, error_description: registration.description },
			{ status: 400 }
		);
	}
	return json(registration.metadata, { status: 201 });
};
