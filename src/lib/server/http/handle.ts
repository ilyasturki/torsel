import { json } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';

import type { Credential } from '../auth/session.ts';
import { SESSION_COOKIE, bearerToken, resolveCredential, secureCookies } from '../auth/session.ts';
import type { Database } from '../db/client.ts';
import { oauthOrigin, siteOrigin } from '../config.ts';
import { errorResponse } from '../api/errors.ts';
import {
	API_PATH,
	MCP_PATH,
	REVOKE_PATH,
	TOKEN_PATH,
	challenge,
	discoveryResponse
} from '../oauth/metadata.ts';
import { mediaType } from './body.ts';
import { applyCors, openCors, preflightResponse } from './cors.ts';
import { PUBLIC_API_ROUTES } from './public-routes.ts';
import { errors } from '../../i18n/errors.ts';

function isApiPath(pathname: string): boolean {
	return pathname === '/api' || pathname.startsWith('/api/');
}

function isRestPath(pathname: string): boolean {
	return pathname === API_PATH || pathname.startsWith(`${API_PATH}/`);
}

// SvelteKit routes on the decoded path, so `GET /%61pi/x` reaches `/api/x`: matching
// the raw pathname instead is an auth bypass. `%25` is split, not decoded, on purpose.
function routedPath(pathname: string): string {
	try {
		return pathname
			.split('%25')
			.map((part) => decodeURI(part))
			.join('%25');
	} catch {
		return pathname;
	}
}

const FORM_TYPES = new Set([
	'application/x-www-form-urlencoded',
	'multipart/form-data',
	'text/plain',
	'application/x-sveltekit-formdata'
]);
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// OAuth clients post these forms from their own servers, with no Origin at all.
const FORMS_FROM_ANYWHERE = new Set([TOKEN_PATH, REVOKE_PATH]);

// SvelteKit's own check, off in the kit config, can't spare a path; self is the pinned ORIGIN, as adapter-node calls every request https.
// A browser attaches cached Basic credentials to a form, never a Bearer token.
export function crossSiteForm(request: Request, url: URL, pathname: string): boolean {
	const type = mediaType(request);
	const form = type === '' || FORM_TYPES.has(type);
	return (
		form &&
		MUTATING.has(request.method) &&
		bearerToken(request) === null &&
		request.headers.get('origin') !== (siteOrigin(url) ?? url.origin) &&
		!FORMS_FROM_ANYWHERE.has(pathname)
	);
}

/** Web and device credentials reach the whole API; a token for agents reaches only MCP and the REST API, and an OAuth one only its own audience. */
function reaches(credential: Credential, pathname: string, url: URL): boolean {
	const { kind, resource } = credential.token;
	if (kind === 'web' || kind === 'device') {
		return true;
	}
	const audience = pathname === MCP_PATH ? MCP_PATH : isRestPath(pathname) ? API_PATH : null;
	if (audience === null) {
		return false;
	}
	if (kind === 'oauth') {
		const origin = oauthOrigin(url);
		return origin !== null && resource === `${origin}${audience}`;
	}
	return true;
}

// The page CSP comes from `csp` in vite.config.ts, which alone can nonce SvelteKit's inline boot script. Prerendered pages and static files skip this: the reverse proxy adds these for them.
function harden(response: Response, url: URL): Response {
	const { headers } = response;

	headers.set('x-content-type-options', 'nosniff');
	headers.set('x-frame-options', 'DENY');
	headers.set('referrer-policy', 'same-origin');
	headers.set('permissions-policy', 'camera=(), geolocation=(), microphone=()');
	headers.set('cross-origin-opener-policy', 'same-origin');

	if (secureCookies(url)) {
		headers.set('strict-transport-security', 'max-age=31536000');
	}

	return response;
}

export function createHandle(database: () => Database): Handle {
	const respond: Handle = async ({ event, resolve }) => {
		const pathname = routedPath(event.url.pathname);

		if (crossSiteForm(event.request, event.url, pathname)) {
			return json(
				{ message: `Cross-site ${event.request.method} form submissions are forbidden` },
				{ status: 403 }
			);
		}

		const discovery = discoveryResponse(event.request, event.url);
		if (discovery !== undefined) {
			return discovery;
		}

		const api =
			isApiPath(pathname) || isApiPath(event.url.pathname) || isApiPath(event.route.id ?? '');

		if (!api) {
			event.locals.credential = null;
			const response = await resolve(event);
			if (pathname === '/app' || pathname.startsWith('/app/')) {
				response.headers.set('x-robots-tag', 'noindex');
			}
			return response;
		}

		const origin = event.request.headers.get('origin');
		// The REST API takes a bearer token only, never the cookie: any page may call it, as no browser holds its credential.
		const rest = isRestPath(pathname);
		const cors = (response: Response) => (rest ? openCors(response) : applyCors(response, origin));

		if (event.request.method === 'OPTIONS') {
			return cors(preflightResponse());
		}

		const secret =
			bearerToken(event.request) ?? (rest ? null : (event.cookies.get(SESSION_COOKIE) ?? null));

		let credential: Credential | null;
		try {
			credential = resolveCredential(database(), secret);
		} catch (error) {
			console.error('could not resolve a credential:', error);
			return cors(
				rest
					? errorResponse(503, 'unavailable', errors.databaseUnavailable)
					: json({ message: errors.databaseUnavailable }, { status: 503 })
			);
		}

		// An OAuth token for another audience is no token here: the client is told to sign in again.
		if (
			credential !== null &&
			(pathname === MCP_PATH || rest) &&
			!reaches(credential, pathname, event.url)
		) {
			credential = null;
		}

		event.locals.credential = credential;

		if (credential === null && !(pathname in PUBLIC_API_ROUTES)) {
			const refused = rest
				? errorResponse(401, 'unauthorized', errors.authRequired)
				: json({ message: errors.authRequired }, { status: 401 });
			if (pathname === MCP_PATH || rest) {
				refused.headers.set(
					'www-authenticate',
					challenge(event.url, secret !== null, rest ? API_PATH : MCP_PATH)
				);
			}
			return cors(refused);
		}

		if (credential !== null && !reaches(credential, pathname, event.url)) {
			return cors(
				json({ message: 'an API token reaches only /api/mcp and /api/v1' }, { status: 403 })
			);
		}

		const response = cors(await resolve(event));
		if (!response.headers.has('cache-control')) {
			response.headers.set('cache-control', 'private, no-store');
		}
		return response;
	};

	return async (input) => harden(await respond(input), input.event.url);
}
