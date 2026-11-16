import { error, json } from '@sveltejs/kit';

import { MAX_IMAGE_BYTES, isBaseId, isImageId } from '#lib/core/images.ts';
import { UPLOAD_PART } from '#lib/core/thread.ts';
import { images as words } from '#lib/i18n/images.ts';
import { storageLimit } from '#lib/server/config.ts';
import { getDatabase } from '#lib/server/db/client.ts';
import { requireCredential, requireWriter } from '#lib/server/http/guards.ts';
import type { Refusal } from '#lib/server/images/store.ts';
import { readImage, receiveImagePart } from '#lib/server/images/store.ts';

import type { RequestHandler } from './$types';

const REFUSED: Record<Refusal, [number, () => string]> = {
	'out-of-order': [409, () => words.partOutOfOrder],
	full: [507, () => words.storageFull],
	damaged: [422, () => words.damaged],
	'not-an-image': [415, () => words.notAnImage],
	'too-many-pixels': [422, () => words.tooManyPixels]
};

function target(params: { base: string; id: string }): { baseId: string; id: string } {
	if (!isBaseId(params.base) || !isImageId(params.id)) {
		error(404, 'no such image');
	}
	return { baseId: params.base, id: params.id };
}

/** The bytes as stored: an id names one content forever, and the sandbox keeps them from ever running as a page. */
export const GET: RequestHandler = ({ locals, params }) => {
	const { user } = requireCredential(locals);
	const { baseId, id } = target(params);
	const found = readImage(getDatabase(), user.id, baseId, id);
	if (found === undefined) {
		error(404, 'no such image');
	}
	return new Response(new Uint8Array(found.data), {
		headers: {
			'content-type': found.type,
			'content-length': String(found.data.length),
			'cache-control': 'private, max-age=31536000, immutable',
			'content-security-policy': "default-src 'none'; sandbox",
			'content-disposition': 'inline'
		}
	});
};

/** One part of an image at `offset`; the last one stores it, under its sha-256, once its bytes prove to be an image. */
export const POST: RequestHandler = async ({ locals, params, request, url }) => {
	const { user } = requireWriter(locals);
	const { baseId, id } = target(params);
	const size = Number(url.searchParams.get('size'));
	const offset = Number(url.searchParams.get('offset'));
	if (!Number.isInteger(size) || size <= 0 || size > MAX_IMAGE_BYTES) {
		error(413, words.tooBig);
	}
	const bytes = Buffer.from(await request.arrayBuffer());
	if (
		!Number.isInteger(offset) ||
		offset < 0 ||
		bytes.length === 0 ||
		bytes.length > UPLOAD_PART ||
		offset + bytes.length > size
	) {
		error(400, 'expected a part at an offset');
	}

	const received = receiveImagePart(
		getDatabase(),
		{ userId: user.id, baseId, id, size, offset, bytes },
		storageLimit()
	);
	if (received.status === 'refused') {
		const [status, message] = REFUSED[received.reason];
		error(status, message());
	}
	return json(received.status === 'stored' ? { ref: received.ref } : received);
};
