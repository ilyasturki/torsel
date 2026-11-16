import { json } from '@sveltejs/kit';

import { openApiDocument } from '#lib/server/api/openapi.ts';
import { oauthOrigin, siteOrigin } from '#lib/server/config.ts';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url }) =>
	json(
		openApiDocument(siteOrigin(url) ?? url.origin, oauthOrigin(url), import.meta.env.APP_VERSION),
		{ headers: { 'cache-control': 'public, max-age=300' } }
	);
