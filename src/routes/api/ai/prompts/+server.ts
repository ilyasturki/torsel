import { error, json } from '@sveltejs/kit';

import { MAX_PROMPT, MAX_SAVED, MAX_SAVED_NAME } from '#lib/core/thread.ts';
import { assistant as words } from '#lib/i18n/assistant.ts';
import { countPrompts, listPrompts, savePrompt } from '#lib/server/agent/prompts.ts';
import { getDatabase } from '#lib/server/db/client.ts';
import { readJsonBody, requiredString } from '#lib/server/http/body.ts';
import { requireCredential } from '#lib/server/http/guards.ts';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals }) => {
	const { user } = requireCredential(locals);
	return json(listPrompts(getDatabase(), user.id));
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const { user } = requireCredential(locals);
	const body = await readJsonBody(request);
	const name = requiredString(body, 'name').replace(/\s+/gu, ' ').trim();
	const text = requiredString(body, 'text').trim();
	if (name === '' || text === '') {
		error(400, words.savedEmpty);
	}
	if (name.length > MAX_SAVED_NAME || text.length > MAX_PROMPT) {
		error(400, words.promptTooLong);
	}
	const db = getDatabase();
	if (countPrompts(db, user.id) >= MAX_SAVED) {
		error(409, words.savedFull(MAX_SAVED));
	}
	return json(savePrompt(db, user.id, name, text));
};
