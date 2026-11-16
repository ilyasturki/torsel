import { error } from '@sveltejs/kit';

import type { Credential } from '../auth/session.ts';
import { errors } from '../../i18n/errors.ts';

export function requireCredential(locals: App.Locals): Credential {
	if (locals.credential === null) {
		error(401, errors.authRequired);
	}

	return locals.credential;
}
