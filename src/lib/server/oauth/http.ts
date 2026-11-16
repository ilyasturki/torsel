import type { TokenAnswer } from './flow.ts';

/** The body of a form-encoded OAuth request, or null when it isn't one. */
export async function readForm(request: Request): Promise<URLSearchParams | null> {
	const type = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
	if (type !== 'application/x-www-form-urlencoded') {
		return null;
	}
	return new URLSearchParams(await request.text());
}

export const NOT_A_FORM: TokenAnswer = {
	status: 400,
	body: {
		error: 'invalid_request',
		error_description: 'the body must be application/x-www-form-urlencoded'
	}
};

export function tokenResponse({ status, body }: TokenAnswer): Response {
	return Response.json(body, {
		status,
		headers: { 'cache-control': 'no-store', pragma: 'no-cache' }
	});
}
