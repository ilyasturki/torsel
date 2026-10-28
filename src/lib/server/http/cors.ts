import { allowedOrigins } from '../config.ts';

const ALLOWED_HEADERS = 'authorization, content-type';
const ALLOWED_METHODS = 'GET, POST, PATCH, DELETE, OPTIONS';

const MAX_AGE_SECONDS = 86_400;

export function applyCors(response: Response, origin: string | null): Response {
	response.headers.append('vary', 'Origin');

	if (origin !== null && allowedOrigins().includes(origin)) {
		response.headers.set('access-control-allow-origin', origin);
	}

	return response;
}

export function preflightResponse(): Response {
	return new Response(null, {
		status: 204,
		headers: {
			'access-control-allow-methods': ALLOWED_METHODS,
			'access-control-allow-headers': ALLOWED_HEADERS,
			'access-control-max-age': String(MAX_AGE_SECONDS)
		}
	});
}
