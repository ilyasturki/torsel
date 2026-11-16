import { json } from '@sveltejs/kit';

import { sourceName } from '#lib/core/source.ts';
import { getDatabase } from '#lib/server/db/client.ts';
import { readJsonBody } from '#lib/server/http/body.ts';
import { requireCredential } from '#lib/server/http/guards.ts';
import { createSource, publicSource } from '#lib/server/sources/connect.ts';
import { createBody, failure, limit } from '#lib/server/sources/http.ts';
import { runSource } from '#lib/server/sources/run.ts';
import { readSource } from '#lib/server/sources/store.ts';

import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	const { user } = requireCredential(locals);
	limit('create', user.id);
	const db = getDatabase();
	try {
		const spec = createBody(await readJsonBody(request));
		const made = await createSource(db, user.id, {
			...spec,
			label: spec.label ?? sourceName(spec.url)
		});
		const outcome = await runSource(db, user.id, made.table);
		const source = readSource(db, user.id, made.table);
		return json(
			{ ...made, outcome, source: source === undefined ? null : publicSource(source) },
			{ status: 201 }
		);
	} catch (thrown) {
		return failure(thrown);
	}
};
