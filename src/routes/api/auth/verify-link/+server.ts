import { error } from '@sveltejs/kit';

import { consumeEmailToken } from '#lib/server/auth/email-tokens.ts';
import { getDatabase } from '#lib/server/db/client.ts';
import { readJsonBody, requiredString } from '#lib/server/http/body.ts';
import { finishProof } from '#lib/server/http/sign-in.ts';

import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const body = await readJsonBody(event.request);
	const db = getDatabase();

	const consumed = consumeEmailToken(db, requiredString(body, 'token'));
	if (consumed === null) {
		error(401, 'invalid or expired link');
	}

	const response = finishProof(db, event, consumed.userId, { kind: 'web' }, undefined);
	if (response === null) {
		error(401, 'invalid or expired link');
	}
	return response;
};
