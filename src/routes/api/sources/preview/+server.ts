import { json } from '@sveltejs/kit';

import { sourceName } from '#lib/core/source.ts';
import { readJsonBody } from '#lib/server/http/body.ts';
import { requireCredential } from '#lib/server/http/guards.ts';
import { previewSource } from '#lib/server/sources/connect.ts';
import { failure, limit, previewBody } from '#lib/server/sources/http.ts';

import type { RequestHandler } from './$types';

const FEEDS = new Set(['rss', 'atom']);

export const POST: RequestHandler = async ({ request, locals }) => {
	const { user } = requireCredential(locals);
	limit('preview', user.id);
	try {
		const body = previewBody(await readJsonBody(request));
		const preview = await previewSource(body);
		const preset = body.preset;
		const label = preset?.label ?? sourceName(preview.url);
		return json({
			...preview,
			columns: preset?.columns ?? preview.columns,
			suggested: {
				label,
				name: preset?.name ?? label,
				key: preset?.key ?? preview.key,
				filter: preset?.filter ?? null,
				every: preset?.every ?? 'hour',
				// A feed shows only its latest items: what drops off is history, not a deletion.
				missing: preset?.missing ?? (FEEDS.has(preview.format) ? 'keep' : 'remove'),
				auth: body.auth
			}
		});
	} catch (thrown) {
		return failure(thrown);
	}
};
