import { error } from '@sveltejs/kit';

import { jsonObject } from '../json.ts';
import { errors } from '../../i18n/errors.ts';

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
		error(400, errors.required(field));
	}

	return value;
}
