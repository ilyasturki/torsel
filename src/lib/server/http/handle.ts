import { json } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';

import type { Credential } from '../auth/session.ts';
import { SESSION_COOKIE, bearerToken, resolveCredential, secureCookies } from '../auth/session.ts';
import type { Database } from '../db/client.ts';
import { applyCors, preflightResponse } from './cors.ts';
import { PUBLIC_API_ROUTES } from './public-routes.ts';

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
			return applyCors(json({ message: 'database unavailable' }, { status: 503 }), origin);
		}

		event.locals.credential = credential;

		if (credential === null && !(pathname in PUBLIC_API_ROUTES)) {
			return applyCors(json({ message: 'authentication required' }, { status: 401 }), origin);
		}

		const response = applyCors(await resolve(event), origin);
		if (!response.headers.has('cache-control')) {
			response.headers.set('cache-control', 'private, no-store');
		}
		return response;
	};

	return async (input) => harden(await respond(input), input.event.url);
}
