import { json } from '@sveltejs/kit';

import { getDatabase } from '#lib/server/db/client.ts';
import { requireCredential } from '#lib/server/http/guards.ts';
import { SourceRefused, publicSource } from '#lib/server/sources/connect.ts';
import { failure, limit } from '#lib/server/sources/http.ts';
import { runSource } from '#lib/server/sources/run.ts';
import { readSource } from '#lib/server/sources/store.ts';

import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, params }) => {
	const { user } = requireCredential(locals);
	const db = getDatabase();
	if (readSource(db, user.id, params.table) === undefined) {
		return failure(new SourceRefused('gone'));
	}
	limit('refresh', user.id);
	const outcome = await runSource(db, user.id, params.table);
	const source = readSource(db, user.id, params.table);
	return json({ outcome, source: source === undefined ? null : publicSource(source) });
};
