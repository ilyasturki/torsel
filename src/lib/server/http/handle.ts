import { json } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';

import type { Credential } from '../auth/session.ts';
import { SESSION_COOKIE, bearerToken, resolveCredential } from '../auth/session.ts';
import type { Database } from '../db/client.ts';
import { applyCors, preflightResponse } from './cors.ts';

const PUBLIC_API_PATHS = new Set(['/api/health', '/api/auth/login']);

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

export function createHandle(database: () => Database): Handle {
	return async ({ event, resolve }) => {
		const pathname = routedPath(event.url.pathname);

		const api =
			isApiPath(pathname) || isApiPath(event.url.pathname) || isApiPath(event.route.id ?? '');

		if (!api) {
			event.locals.credential = null;
			return resolve(event);
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

		if (credential === null && !PUBLIC_API_PATHS.has(pathname)) {
			return applyCors(json({ message: 'authentication required' }, { status: 401 }), origin);
		}

		return applyCors(await resolve(event), origin);
	};
}
