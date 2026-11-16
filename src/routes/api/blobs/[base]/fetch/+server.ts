import { error, json } from '@sveltejs/kit';

import { isBaseId } from '#lib/core/images.ts';
import { images as words } from '#lib/i18n/images.ts';
import { getDatabase } from '#lib/server/db/client.ts';
import { requireCredential } from '#lib/server/http/guards.ts';
import type { IngestProblem } from '#lib/server/images/ingest.ts';
import { IngestFailed, ingestImage } from '#lib/server/images/ingest.ts';

import type { RequestHandler } from './$types';

const REFUSED: Record<IngestProblem, [number, () => string]> = {
	scheme: [400, () => words.linkScheme],
	address: [400, () => words.linkPrivate],
	timeout: [504, () => words.linkSlow],
	network: [502, () => words.linkUnreachable],
	status: [502, () => words.linkStatus],
	size: [413, () => words.tooBig],
	'not-an-image': [415, () => words.linkNotAnImage],
	'too-many-pixels': [422, () => words.tooManyPixels],
	full: [507, () => words.storageFull],
	busy: [429, () => words.linkBusy]
};

/** The image at `{url}`, fetched once by the server and stored in this base like an upload. */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const { user } = requireCredential(locals);
	if (!isBaseId(params.base)) {
		error(404, 'no such base');
	}
	const body: unknown = await request.json().catch(() => null);
	const url = typeof body === 'object' && body !== null ? (body as { url?: unknown }).url : null;
	if (typeof url !== 'string') {
		error(400, 'expected {url}');
	}
	try {
		return json({ ref: await ingestImage(getDatabase(), user.id, params.base, url) });
	} catch (failure) {
		if (!(failure instanceof IngestFailed)) throw failure;
		const [status, message] = REFUSED[failure.problem];
		if (failure.retryAfter !== null) {
			return json(
				{ message: message() },
				{ status, headers: { 'retry-after': String(failure.retryAfter) } }
			);
		}
		error(status, message());
	}
};
