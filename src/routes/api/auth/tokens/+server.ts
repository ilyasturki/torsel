import { json } from '@sveltejs/kit';

import { issueToken, listTokens } from '#lib/server/auth/accounts.ts';
import { getDatabase } from '#lib/server/db/client.ts';
import { readJsonBody, requiredString } from '#lib/server/http/body.ts';
import { requireCredential } from '#lib/server/http/guards.ts';
import { publicToken } from '#lib/server/http/shapes.ts';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals }) => {
	const { user, token } = requireCredential(locals);

	return json(
		listTokens(getDatabase(), user.id).map((record) => publicToken(record, record.id === token.id))
	);
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const { user } = requireCredential(locals);

	const body = await readJsonBody(request);
	const { token, record } = issueToken(
		getDatabase(),
		user.id,
		requiredString(body, 'label'),
		'api'
	);

	return json({ token, credential: publicToken(record, false) }, { status: 201 });
};
