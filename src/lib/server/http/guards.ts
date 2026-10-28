import { error } from '@sveltejs/kit';

import type { Credential } from '../auth/session.ts';

export function requireCredential(locals: App.Locals): Credential {
	if (locals.credential === null) {
		error(401, 'authentication required');
	}

	return locals.credential;
}
