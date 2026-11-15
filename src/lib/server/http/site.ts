import type { Handle } from '@sveltejs/kit/hooks';

import { localePath, type SiteLocale } from '../../site/site.ts';

export const VISITED_COOKIE = 'torsel_visited';
const YEAR = 60 * 60 * 24 * 365;

/** The first of en and fr the browser lists, by q-value; English when it lists neither. */
export function wantedLocale(header: string | null): SiteLocale {
	const tags = (header ?? '')
		.split(',')
		.map((part) => {
			const [tag, ...params] = part.trim().split(';');
			const q = params.map((param) => param.trim()).find((param) => param.startsWith('q='));
			return { tag: tag.trim().toLowerCase(), q: q === undefined ? 1 : Number(q.slice(2)) };
		})
		.filter(({ tag, q }) => tag !== '' && q > 0)
		.sort((a, b) => b.q - a.q);
	for (const { tag } of tags) {
		const primary = tag.split(/[-_]/u)[0];
		if (primary === 'en' || primary === 'fr') return primary;
	}
	return 'en';
}

/** Where a first visit to an English site page goes instead, if anywhere. */
export function firstVisitRedirect(
	url: URL,
	prefixed: boolean,
	visited: boolean,
	acceptLanguage: string | null
): string | null {
	if (prefixed || visited) return null;
	const wanted = wantedLocale(acceptLanguage);
	return wanted === 'en' ? null : `${localePath(wanted, url.pathname)}${url.search}`;
}

export const handleSite: Handle = async ({ event, resolve }) => {
	if (event.route.id?.startsWith('/(site)') !== true) return resolve(event);
	const prefixed = event.params.lang !== undefined;
	const visited = event.cookies.get(VISITED_COOKIE) !== undefined;
	const remember = {
		path: '/',
		maxAge: YEAR,
		httpOnly: true,
		sameSite: 'lax',
		secure: event.url.protocol === 'https:'
	} as const;
	const location = firstVisitRedirect(
		event.url,
		prefixed,
		visited,
		event.request.headers.get('accept-language')
	);
	if (location !== null) {
		return new Response(null, {
			status: 307,
			headers: {
				location,
				vary: 'accept-language, cookie',
				'set-cookie': event.cookies.serialize(VISITED_COOKIE, '1', remember)
			}
		});
	}
	if (!visited) event.cookies.set(VISITED_COOKIE, '1', remember);
	const locale: SiteLocale = prefixed ? 'fr' : 'en';
	const response = await resolve(event, {
		transformPageChunk: ({ html }) => html.replace('<html lang="en">', `<html lang="${locale}">`)
	});
	if (!prefixed) response.headers.append('vary', 'accept-language, cookie');
	return response;
};
