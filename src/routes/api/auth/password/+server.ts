import { error, json } from '@sveltejs/kit';

import { setPassword } from '#lib/server/auth/accounts.ts';
import { passwordProblem } from '#lib/server/auth/password.ts';
import { acquireVerificationSlot, saturated } from '#lib/server/auth/throttle.ts';
import { getDatabase } from '#lib/server/db/client.ts';
import { deliver, passwordNoticeMail } from '#lib/server/email.ts';
import { readJsonBody, requiredString } from '#lib/server/http/body.ts';
import { requireCredential } from '#lib/server/http/guards.ts';

import type { RequestHandler } from './$types';

// No old password asked: an emailed code already stands in for it, and the notice below tells the owner.
export const POST: RequestHandler = async ({ request, locals }) => {
	const { user } = requireCredential(locals);

	const password = requiredString(await readJsonBody(request), 'password');
	const problem = passwordProblem(password);
	if (problem !== undefined) {
		error(400, problem);
	}
	if (saturated()) {
		error(503, 'too many sign-in attempts in flight, try again');
	}

	const release = await acquireVerificationSlot();
	try {
		await setPassword(getDatabase(), user.id, password);
	} finally {
		release();
	}

	void deliver(passwordNoticeMail(user.email, 'set'));

	return json({ status: 'ok' });
};
