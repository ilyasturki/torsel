import { error, json } from '@sveltejs/kit';

import { emailProblem, normalizeEmail } from '#lib/server/auth/accounts.ts';
import { setClaimCookie } from '#lib/server/auth/claim-cookie.ts';
import { claimAddress } from '#lib/server/auth/ownership.ts';
import { hashPassword, passwordProblem } from '#lib/server/auth/password.ts';
import { LIMITS, enforce } from '#lib/server/auth/rate-limit.ts';
import { acquireVerificationSlot, saturated } from '#lib/server/auth/throttle.ts';
import { signUpOpen } from '#lib/server/config.ts';
import { getDatabase } from '#lib/server/db/client.ts';
import { readJsonBody, requiredString } from '#lib/server/http/body.ts';
import { readClient } from '#lib/server/http/grant.ts';
import { sendSignInMail } from '#lib/server/http/sign-in.ts';

import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, cookies, url, getClientAddress }) => {
	const body = await readJsonBody(request);
	const email = normalizeEmail(requiredString(body, 'email'));
	const client = readClient(body);
	const password = typeof body.password === 'string' && body.password !== '' ? body.password : null;

	enforce(LIMITS.signUp, getClientAddress(), email);

	if (!signUpOpen()) {
		error(403, 'this server does not take new accounts');
	}

	const problem =
		emailProblem(email) ?? (password === null ? undefined : passwordProblem(password));
	if (problem !== undefined) {
		error(400, problem);
	}
	if (saturated()) {
		error(503, 'too many sign-in attempts in flight, try again');
	}

	let passwordHash: string | null = null;
	if (password !== null) {
		const release = await acquireVerificationSlot();
		try {
			passwordHash = await hashPassword(password);
		} finally {
			release();
		}
	}

	const db = getDatabase();
	const claim = claimAddress(db, email, passwordHash);

	if (claim.outcome !== 'owned') {
		if (client.kind === 'web') {
			setClaimCookie(cookies, url, claim.nonce);
		}
		await sendSignInMail(db, url, { id: claim.userId, email }, 'verify', body.to, client.kind);
	}

	// An owned address gets the same answer with nothing sent or changed.
	return json(client.kind === 'web' ? { status: 'ok' } : { status: 'ok', claim: claim.nonce });
};
