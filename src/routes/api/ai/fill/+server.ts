import Anthropic from '@anthropic-ai/sdk';
import { error, json } from '@sveltejs/kit';

import { FILL_BATCH, MAX_FILL_PROMPT } from '#lib/core/autofill.ts';
import { isId } from '#lib/core/ids.ts';
import type { Value } from '#lib/core/model.ts';
import { assistant as words } from '#lib/i18n/assistant.ts';
import type { FillAsk } from '#lib/server/agent/fill.ts';
import { fillRows } from '#lib/server/agent/fill.ts';
import { refusedResponse, takePrompt } from '#lib/server/agent/quota.ts';
import { aiLimits, anthropicKey } from '#lib/server/config.ts';
import { getDatabase } from '#lib/server/db/client.ts';
import { readJsonBody, requiredString } from '#lib/server/http/body.ts';
import { requireCredential } from '#lib/server/http/guards.ts';

import type { RequestHandler } from './$types';

// A row's inputs as JSON; past it a row is not a few named fields.
const MAX_INPUTS = 4000;

function rowsOf(value: unknown): FillAsk['rows'] {
	if (!Array.isArray(value) || value.length === 0 || value.length > FILL_BATCH) {
		error(400, words.fillRows(FILL_BATCH));
	}
	return value.map((item) => {
		const { row, inputs } = (item ?? {}) as Record<string, unknown>;
		if (
			!isId(row) ||
			typeof inputs !== 'object' ||
			inputs === null ||
			Array.isArray(inputs) ||
			JSON.stringify(inputs).length > MAX_INPUTS
		) {
			error(400, words.fillRows(FILL_BATCH));
		}
		return { row, inputs: inputs as Record<string, Value> };
	});
}

/** One fill counts as one prompt; a failed model call answers with no values, never a 5xx. */
export const POST: RequestHandler = async ({ request, locals }) => {
	const { user } = requireCredential(locals);
	const body = await readJsonBody(request);
	const ask: FillAsk = {
		field: requiredString(body, 'field').slice(0, 200),
		type: requiredString(body, 'type').slice(0, 2000),
		prompt: requiredString(body, 'prompt'),
		web: body.web === true,
		rows: rowsOf(body.rows)
	};
	if (ask.prompt.length > MAX_FILL_PROMPT) {
		error(400, words.promptTooLong);
	}
	const apiKey = anthropicKey();
	if (apiKey === undefined) {
		error(503, words.noAssistant);
	}
	const refusal = takePrompt(getDatabase(), user, aiLimits());
	if (refusal !== null) {
		return refusedResponse(refusal);
	}
	try {
		return json({ values: await fillRows(new Anthropic({ apiKey }), ask, request.signal) });
	} catch (thrown) {
		console.error('fill:', thrown instanceof Error ? thrown.message : thrown);
		return json({ values: [], failed: true });
	}
};
