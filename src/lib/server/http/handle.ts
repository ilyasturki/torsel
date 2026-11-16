import { json } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';

import type { Credential } from '../auth/session.ts';
import { SESSION_COOKIE, bearerToken, resolveCredential, secureCookies } from '../auth/session.ts';
import type { Database } from '../db/client.ts';
import { oauthOrigin, siteOrigin } from '../config.ts';
import {
	MCP_PATH,
	REVOKE_PATH,
	TOKEN_PATH,
	discoveryResponse,
	mcpChallenge,
	mcpResource
} from '../oauth/metadata.ts';
import { mediaType } from './body.ts';
import { applyCors, preflightResponse } from './cors.ts';
import { PUBLIC_API_ROUTES } from './public-routes.ts';
import { errors } from '../../i18n/errors.ts';

function isApiPath(pathname: string): boolean {
	return pathname === '/api' || pathname.startsWith('/api/');
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
export function crossSiteForm(request: Request, url: URL, pathname: string): boolean {
	const type = mediaType(request);
	const form = type === '' || FORM_TYPES.has(type);
	return (
		form &&
		MUTATING.has(request.method) &&
		request.headers.get('origin') !== (siteOrigin(url) ?? url.origin) &&
		!FORMS_FROM_ANYWHERE.has(pathname)
	);
}

/** Web and device credentials reach the whole API; a token for agents reaches only MCP, and an OAuth one only its own audience. */
function reaches(credential: Credential, pathname: string, url: URL): boolean {
	const { kind, resource } = credential.token;
	if (kind === 'web' || kind === 'device') {
		return true;
	}
	if (pathname !== MCP_PATH) {
		return false;
	}
	if (kind === 'oauth') {
		const origin = oauthOrigin(url);
		return origin !== null && resource === mcpResource(origin);
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

		if (event.request.method === 'OPTIONS') {
			return applyCors(preflightResponse(), origin);
		}

		const secret = bearerToken(event.request) ?? event.cookies.get(SESSION_COOKIE) ?? null;

		let credential: Credential | null;
		try {
			credential = resolveCredential(database(), secret);
		} catch (error) {
			console.error('could not resolve a credential:', error);
			return applyCors(json({ message: errors.databaseUnavailable }, { status: 503 }), origin);
		}

		// An OAuth token for another audience is no token here: the client is told to sign in again.
		if (credential !== null && pathname === MCP_PATH && !reaches(credential, pathname, event.url)) {
			credential = null;
		}

		event.locals.credential = credential;

		if (credential === null && !(pathname in PUBLIC_API_ROUTES)) {
			const refused = json({ message: errors.authRequired }, { status: 401 });
			if (pathname === MCP_PATH) {
				refused.headers.set('www-authenticate', mcpChallenge(event.url, secret !== null));
			}
			return applyCors(refused, origin);
		}

		if (credential !== null && !reaches(credential, pathname, event.url)) {
			return applyCors(
				json({ message: 'an API token reaches only /api/mcp' }, { status: 403 }),
				origin
			);
		}

		const response = applyCors(await resolve(event), origin);
		if (!response.headers.has('cache-control')) {
			response.headers.set('cache-control', 'private, no-store');
		}
		return response;
	};

	return async (input) => harden(await respond(input), input.event.url);
}
