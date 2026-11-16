import { error, json } from '@sveltejs/kit';

import { publish as words } from '#lib/i18n/publish.ts';
import { getDatabase } from '#lib/server/db/client.ts';
import { readJsonBody, requiredString } from '#lib/server/http/body.ts';
import { requireCredential } from '#lib/server/http/guards.ts';
import { listPublications, publish, publishableView } from '#lib/server/publish/store.ts';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals }) => {
	const { user } = requireCredential(locals);
	return json(listPublications(getDatabase(), user.id));
};

/** Publishes a view the server already holds: one made offline waits for its sync. */
export const POST: RequestHandler = async ({ locals, request }) => {
	const { user } = requireCredential(locals);
	const view = requiredString(await readJsonBody(request), 'view');
	const db = getDatabase();
	if (publishableView(db, user.id, view) === undefined) {
		error(404, words.noSuchView);
	}
	return json({ view, token: publish(db, user.id, view) });
};
