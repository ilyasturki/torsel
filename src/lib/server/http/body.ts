import { error } from '@sveltejs/kit';

import { jsonObject } from '../json.ts';

export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
	const body = await jsonObject(request);

	if (body === undefined) {
		error(400, 'expected a JSON object');
	}

	return body;
}

export function requiredString(body: Record<string, unknown>, field: string): string {
	const value = body[field];

	if (typeof value !== 'string' || value.trim() === '') {
		error(400, `${field} is required`);
	}

	return value;
}
