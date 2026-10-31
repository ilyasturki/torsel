import { json } from '@sveltejs/kit';

import { emailProblem, findUserByEmail, normalizeEmail } from '#lib/server/auth/accounts.ts';
import { LIMITS, enforce } from '#lib/server/auth/rate-limit.ts';
import { getDatabase } from '#lib/server/db/client.ts';
import { readJsonBody, requiredString } from '#lib/server/http/body.ts';
import { sendSignInMail } from '#lib/server/http/sign-in.ts';

import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, url, getClientAddress }) => {
	const body = await readJsonBody(request);
	const email = normalizeEmail(requiredString(body, 'email'));

	enforce(LIMITS.link, getClientAddress(), email);

	const db = getDatabase();
	const user = emailProblem(email) === undefined ? findUserByEmail(db, email) : undefined;

	if (user !== undefined) {
		await sendSignInMail(
			db,
			url,
			user,
			user.emailVerifiedAt === null ? 'verify' : 'login',
			body.to
		);
	}

	return json({ status: 'ok' });
};
