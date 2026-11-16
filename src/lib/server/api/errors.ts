import { json } from '@sveltejs/kit';
import { z } from 'zod';

import { ToolError } from '../agent/toolkit.ts';

export class ApiError extends Error {
	public constructor(
		public readonly status: number,
		public readonly code: string,
		message: string
	) {
		super(message);
		this.name = 'ApiError';
	}
}

export const ERROR = z
	.strictObject({ error: z.strictObject({ code: z.string(), message: z.string() }) })
	.meta({ id: 'Error' });

export function errorResponse(status: number, code: string, message: string): Response {
	return json({ error: { code, message } }, { status });
}

export function located<T>(find: () => T): T {
	try {
		return find();
	} catch (error) {
		if (error instanceof ToolError) throw new ApiError(404, 'not_found', error.message);
		throw error;
	}
}
