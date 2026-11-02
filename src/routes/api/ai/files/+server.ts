import { error, json } from '@sveltejs/kit';

import { MAX_FILE_BYTES, UPLOAD_PART } from '#lib/core/thread.ts';
import { kindOf } from '#lib/server/agent/files.ts';
import { receivePart } from '#lib/server/agent/threads.ts';
import { getDatabase } from '#lib/server/db/client.ts';
import { requireCredential } from '#lib/server/http/guards.ts';

import type { RequestHandler } from './$types';

/** One part of a file for the assistant, raw bytes at `offset`: a whole file can't fit one body. */
export const POST: RequestHandler = async ({ request, locals, url }) => {
	const { user } = requireCredential(locals);
	const query = url.searchParams;
	const id = query.get('id') ?? '';
	const name = (query.get('name') ?? '').slice(0, 200);
	const type = (query.get('type') ?? '').slice(0, 100);
	const size = Number(query.get('size'));
	const offset = Number(query.get('offset'));

	if (!/^[0-9a-f-]{36}$/u.test(id) || name === '') {
		error(400, 'expected id and name');
	}
	if (!Number.isInteger(size) || size <= 0 || size > MAX_FILE_BYTES) {
		error(413, 'files go up to 10 MB');
	}
	if (kindOf({ name, type }) === null) {
		error(415, 'this file type can’t be read');
	}
	const part = Buffer.from(await request.arrayBuffer());
	if (!Number.isInteger(offset) || offset < 0 || part.length === 0 || part.length > UPLOAD_PART) {
		error(400, 'expected a part at an offset');
	}

	const received = receivePart(getDatabase(), user.id, { id, name, type, size }, offset, part);
	if (received === null) {
		error(409, 'this part doesn’t follow the last one');
	}
	return json({ received });
};
