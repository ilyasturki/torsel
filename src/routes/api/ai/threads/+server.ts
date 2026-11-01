import { error, json } from '@sveltejs/kit';

import { MAX_PROMPT } from '#lib/core/thread.ts';
import { promptRefusal, refusedResponse } from '#lib/server/agent/quota.ts';
import { createThread, listThreads } from '#lib/server/agent/threads.ts';
import { aiLimits } from '#lib/server/config.ts';
import { getDatabase } from '#lib/server/db/client.ts';
import { readJsonBody, requiredString } from '#lib/server/http/body.ts';
import { requireCredential } from '#lib/server/http/guards.ts';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals }) => {
	const { user } = requireCredential(locals);
	return json(listThreads(getDatabase(), user.id));
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const { user } = requireCredential(locals);
	const prompt = requiredString(await readJsonBody(request), 'prompt');
	if (prompt.length > MAX_PROMPT) {
		error(400, 'prompt is too long');
	}
	const db = getDatabase();
	// Its first message would be refused, and the thread would stay listed with nothing in it.
	const refusal = promptRefusal(db, user, aiLimits());
	if (refusal !== null) {
		return refusedResponse(refusal);
	}
	return json(createThread(db, user.id, prompt));
};
