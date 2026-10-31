import { json } from '@sveltejs/kit';

import { publicToken, publicUser } from '#lib/server/http/shapes.ts';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals }) => {
	if (locals.credential === null) {
		return json({ user: null, credential: null });
	}

	const { user, token } = locals.credential;

	return json({ user: publicUser(user), credential: publicToken(token, true) });
};
