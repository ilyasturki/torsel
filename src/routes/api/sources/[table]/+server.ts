import { json } from '@sveltejs/kit';

import { getDatabase } from '#lib/server/db/client.ts';
import { readJsonBody } from '#lib/server/http/body.ts';
import { requireCredential } from '#lib/server/http/guards.ts';
import {
	SourceRefused,
	patchSource,
	publicSource,
	stopSource
} from '#lib/server/sources/connect.ts';
import { failure, limit, patchBody } from '#lib/server/sources/http.ts';
import { runSource } from '#lib/server/sources/run.ts';
import { readSource } from '#lib/server/sources/store.ts';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals, params }) => {
	const { user } = requireCredential(locals);
	const source = readSource(getDatabase(), user.id, params.table);
	return source === undefined ? failure(new SourceRefused('gone')) : json(publicSource(source));
};

/** A new key runs the source at once: the person typed it to see the rows. */
export const PATCH: RequestHandler = async ({ request, locals, params }) => {
	const { user } = requireCredential(locals);
	const db = getDatabase();
	try {
		const patch = patchBody(await readJsonBody(request));
		patchSource(db, user.id, params.table, patch);
		let outcome = null;
		if (patch.secret !== undefined) {
			limit('refresh', user.id);
			outcome = await runSource(db, user.id, params.table);
		}
		const source = readSource(db, user.id, params.table);
		return json({ outcome, source: source === undefined ? null : publicSource(source) });
	} catch (thrown) {
		return failure(thrown);
	}
};

/** Stops syncing: the table and its rows stay, editable. */
export const DELETE: RequestHandler = async ({ locals, params }) => {
	const { user } = requireCredential(locals);
	const db = getDatabase();
	if (readSource(db, user.id, params.table) === undefined) {
		return failure(new SourceRefused('gone'));
	}
	await stopSource(db, user.id, params.table);
	return new Response(null, { status: 204 });
};
