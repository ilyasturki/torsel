import { error, json } from '@sveltejs/kit';

import { normalizeEmail, verifyLogin } from '#lib/server/auth/accounts.ts';
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
import { grantCredential, readClient } from '#lib/server/http/grant.ts';

import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const { request, getClientAddress } = event;

	const body = await readJsonBody(request);
	const email = requiredString(body, 'email');
	const password = requiredString(body, 'password');
	const client = readClient(body);

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

	if (user.emailVerifiedAt === null) {
		error(403, 'confirm your email first');
	}

	const grant = grantCredential(db, user, client, event);

	return grant.kind === 'web'
		? new Response(null, { status: 204 })
		: json({ token: grant.token, credential: grant.credential }, { status: 201 });
};
