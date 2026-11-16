import type { ApiDocument } from '#lib/site/api-doc.ts';

import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => {
	const response = await fetch('/api/v1/openapi.json');
	return { doc: (await response.json()) as ApiDocument };
};
