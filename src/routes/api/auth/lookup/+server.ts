import { json } from '@sveltejs/kit';

import { findUserByEmail, normalizeEmail } from '#lib/server/auth/accounts.ts';
import { enforceLookup } from '#lib/server/auth/rate-limit.ts';
import { getDatabase } from '#lib/server/db/client.ts';
import { readJsonBody, requiredString } from '#lib/server/http/body.ts';

import type { RequestHandler } from './$types';

// Tells anyone whether an address has an account: the adaptive form needs it, and the per-address limit keeps it from being scraped.
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const body = await readJsonBody(request);
	const email = normalizeEmail(requiredString(body, 'email'));

	enforceLookup(getClientAddress());

	const user = findUserByEmail(getDatabase(), email);

	return json({
		exists: user !== undefined,
		verified: user !== undefined && user.emailVerifiedAt !== null,
		hasPassword: user !== undefined && user.passwordHash !== null,
		hasGoogle: user !== undefined && user.googleSub !== null
	});
};
