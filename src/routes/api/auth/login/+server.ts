import { error, json } from '@sveltejs/kit';

import { issueToken, normalizeEmail, verifyLogin } from '#lib/server/auth/accounts.ts';
import { SESSION_COOKIE, sessionCookieOptions, startWebSession } from '#lib/server/auth/session.ts';
import {
	acquireVerificationSlot,
	clearLoginFailures,
	loginBlocked,
	recordLoginFailure,
	saturated
} from '#lib/server/auth/throttle.ts';
import { getDatabase } from '#lib/server/db/client.ts';
import type { User } from '#lib/server/db/schema.ts';
import { readJsonBody, requiredString } from '#lib/server/http/body.ts';
import { publicToken } from '#lib/server/http/shapes.ts';

import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, cookies, url, locals, getClientAddress }) => {
	const body = await readJsonBody(request);
	const email = requiredString(body, 'email');
	const password = requiredString(body, 'password');

	const client = body.client;
	if (client !== 'web' && client !== 'device') {
		error(400, 'client must be one of: web, device');
	}

	const label = client === 'web' ? null : requiredString(body, 'label');

	const address = getClientAddress();
	const account = normalizeEmail(email);

	if (loginBlocked(address, account)) {
		error(429, 'too many failed attempts, try again later');
	}
	if (saturated()) {
		error(503, 'too many sign-in attempts in flight, try again');
	}

	const db = getDatabase();

	const release = await acquireVerificationSlot();
	let user: User | null;
	try {
		user = await verifyLogin(db, email, password);
	} finally {
		release();
	}

	if (user === null) {
		recordLoginFailure(address, account);
		error(401, 'invalid email or password');
	}

	clearLoginFailures(address, account);

	if (label === null) {
		const { token } = startWebSession(db, user.id, locals.credential);
		cookies.set(SESSION_COOKIE, token, sessionCookieOptions(url));
		return new Response(null, { status: 204 });
	}

	const { token, record } = issueToken(db, user.id, label, 'device');
	return json({ token, credential: publicToken(record, false) }, { status: 201 });
};
