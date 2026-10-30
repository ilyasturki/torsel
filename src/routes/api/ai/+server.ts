import Anthropic from '@anthropic-ai/sdk';
import { error, json } from '@sveltejs/kit';

import { AssistantUnavailable, runAssistant } from '#lib/server/agent/assistant.ts';
import { getDatabase } from '#lib/server/db/client.ts';
import { readJsonBody, requiredString } from '#lib/server/http/body.ts';
import { requireCredential } from '#lib/server/http/guards.ts';

import type { RequestHandler } from './$types';

function optional(value: unknown): string | null {
	return typeof value === 'string' && value !== '' ? value : null;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const { user } = requireCredential(locals);

	const body = await readJsonBody(request);
	const prompt = requiredString(body, 'prompt');
	if (prompt.length > 4000) {
		error(400, 'prompt is too long');
	}

	try {
		const result = await runAssistant(getDatabase(), user.id, prompt, {
			base: optional(body.base),
			table: optional(body.table),
			view: optional(body.view)
		});
		return json(result);
	} catch (thrown) {
		if (thrown instanceof AssistantUnavailable) {
			error(503, thrown.message);
		}
		if (thrown instanceof Anthropic.RateLimitError) {
			error(429, 'the assistant is busy, try again in a moment');
		}
		if (thrown instanceof Anthropic.APIError) {
			console.error('assistant:', thrown.status, thrown.message);
			error(502, 'the assistant did not respond');
		}
		throw thrown;
	}
};
