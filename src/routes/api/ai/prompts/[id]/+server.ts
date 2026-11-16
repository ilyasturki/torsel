import { error } from '@sveltejs/kit';

import { assistant as words } from '#lib/i18n/assistant.ts';
import { deletePrompt } from '#lib/server/agent/prompts.ts';
import { getDatabase } from '#lib/server/db/client.ts';
import { requireCredential } from '#lib/server/http/guards.ts';

import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = ({ locals, params }) => {
	const { user } = requireCredential(locals);
	if (!deletePrompt(getDatabase(), user.id, params.id)) {
		error(404, words.noSaved);
	}
	return new Response(null, { status: 204 });
};
