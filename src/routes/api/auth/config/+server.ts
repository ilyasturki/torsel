import { json } from '@sveltejs/kit';

import { emailDelivers, googleClient, signUpOpen } from '#lib/server/config.ts';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url }) =>
	json({
		signUp: signUpOpen(),
		google: googleClient(url) !== null,
		emailDelivers: emailDelivers()
	});
