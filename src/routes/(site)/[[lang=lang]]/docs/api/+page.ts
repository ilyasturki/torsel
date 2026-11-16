import { error } from '@sveltejs/kit';

import type { ApiDocument } from '#lib/site/api-doc.ts';

import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => {
	const response = await fetch('/api/v1/openapi.json');
	if (!response.ok) {
		error(response.status);
	}
	return { doc: (await response.json()) as ApiDocument };
};
