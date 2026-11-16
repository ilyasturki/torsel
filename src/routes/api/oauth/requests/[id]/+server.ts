import { error, json } from '@sveltejs/kit';

import type { Credential } from '#lib/server/auth/session.ts';
import { oauthOrigin } from '#lib/server/config.ts';
import { getDatabase } from '#lib/server/db/client.ts';
import { mediaType, readJsonBody } from '#lib/server/http/body.ts';
import { requireCredential } from '#lib/server/http/guards.ts';
import { decide, pendingRequest } from '#lib/server/oauth/flow.ts';
import { errors } from '#lib/i18n/errors.ts';

import type { RequestHandler } from './$types';

// Consent is given in a signed-in browser, never with a token an agent could hold.
function signedInBrowser(locals: App.Locals): Credential {
	const credential = requireCredential(locals);
	if (credential.token.kind !== 'web') {
		error(403, errors.consentInBrowser);
	}
	return credential;
}

export const GET: RequestHandler = ({ locals, params }) => {
	const { user } = signedInBrowser(locals);
	const pending = pendingRequest(getDatabase(), params.id);
	if (pending === null) {
		error(404, errors.requestExpired);
	}
	return json({ ...pending, email: user.email });
};

// The cookie rides along on a form another site posts here: only this server's own page, sending JSON, decides.
export const POST: RequestHandler = async ({ request, locals, params, url }) => {
	const { user } = signedInBrowser(locals);
	const origin = oauthOrigin(url);
	if (origin === null || request.headers.get('origin') !== origin) {
		error(403, errors.consentInBrowser);
	}
	if (mediaType(request) !== 'application/json') {
		error(415, 'expected a JSON body');
	}

	const body = await readJsonBody(request);
	const { allow, access } = body;
	if (typeof allow !== 'boolean' || (access !== 'read' && access !== 'write')) {
		error(400, 'allow must be a boolean and access one of: read, write');
	}
	const redirect = decide(getDatabase(), params.id, user.id, { allow, access }, origin);
	if (redirect === null) {
		error(404, errors.requestExpired);
	}
	return json({ redirect });
};
