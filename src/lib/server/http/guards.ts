import { error } from '@sveltejs/kit';

import type { Credential } from '../auth/session.ts';
import { errors } from '../../i18n/errors.ts';

export function requireCredential(locals: App.Locals): Credential {
	if (locals.credential === null) {
		error(401, errors.authRequired);
	}

	return locals.credential;
}

/** A credential that may change data: the app's own sessions, or a token granted write access. */
export function requireWriter(locals: App.Locals): Credential {
	const credential = requireCredential(locals);
	const { kind, access } = credential.token;
	if (kind !== 'web' && kind !== 'device' && access !== 'write') {
		error(403, errors.readOnly);
	}
	return credential;
}
