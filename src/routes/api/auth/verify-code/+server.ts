import { error } from '@sveltejs/kit';

import { findUserByEmail, normalizeEmail } from '#lib/server/auth/accounts.ts';
import { consumeEmailCode } from '#lib/server/auth/email-tokens.ts';
import { LIMITS, enforce } from '#lib/server/auth/rate-limit.ts';
import { getDatabase } from '#lib/server/db/client.ts';
import { readJsonBody, requiredString } from '#lib/server/http/body.ts';
import { readClient } from '#lib/server/http/grant.ts';
import { finishProof } from '#lib/server/http/sign-in.ts';

import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const body = await readJsonBody(event.request);
	const email = normalizeEmail(requiredString(body, 'email'));
	const code = requiredString(body, 'code');
	const client = readClient(body);

	enforce(LIMITS.code, event.getClientAddress(), email);

	const db = getDatabase();
	const user = findUserByEmail(db, email);

	if (
		user === undefined ||
		!/^\d{6}$/u.test(code) ||
		consumeEmailCode(db, user.id, code) === null
	) {
		error(401, 'invalid or expired code');
	}

	const response = finishProof(db, event, user.id, client, body.claim);
	if (response === null) {
		error(401, 'invalid or expired code');
	}
	return response;
};
