import { error } from '@sveltejs/kit';

import { isImageId } from '#lib/core/images.ts';
import { publish as words } from '#lib/i18n/publish.ts';
import { PUBLISHED, enforcePublished } from '#lib/server/auth/rate-limit.ts';
import { getDatabase } from '#lib/server/db/client.ts';
import { readImage } from '#lib/server/images/store.ts';
import { served } from '#lib/server/publish/serve.ts';

import type { RequestHandler } from './$types';

/** An image only a shown cell of the published view holds; the sandbox keeps the bytes from ever running as a page. */
export const GET: RequestHandler = async ({ params, getClientAddress }) => {
	enforcePublished(PUBLISHED.files, getClientAddress());
	const db = getDatabase();
	const found = isImageId(params.id) ? await served(db, params.token) : null;
	const image =
		found === null || !found.images.has(params.id)
			? undefined
			: readImage(db, found.userId, found.baseId, params.id);
	if (image === undefined) {
		error(404, words.noSuchLink);
	}
	return new Response(new Uint8Array(image.data), {
		headers: {
			'content-type': image.type,
			'content-length': String(image.data.length),
			'cache-control': 'private, max-age=60',
			'content-security-policy': "default-src 'none'; sandbox",
			'content-disposition': 'inline',
			'x-robots-tag': 'noindex'
		}
	});
};
