import { AsyncLocalStorage } from 'node:async_hooks';

import type { Handle } from '@sveltejs/kit/hooks';
import { building } from '$app/env';

import {
	BASE_LOCALE,
	acceptedLanguages,
	isLocale,
	pickLocale,
	type Locale
} from '../../i18n/locale.ts';
import { readServerLocale } from '../../i18n/runtime.ts';

const store = new AsyncLocalStorage<Locale>();
readServerLocale(() => store.getStore());

export function requestLocale(request: Request): Locale {
	return pickLocale(acceptedLanguages(request.headers.get('accept-language')));
}

/** Server text in `locale`, for work that outlives the request's own context. */
export function inLocale<T>(locale: Locale, run: () => T): T {
	return store.run(locale, run);
}

export const handleLocale: Handle = async ({ event, resolve }) => {
	const site = event.route.id?.startsWith('/(site)') === true;
	// A site page's language is its address: `/fr` or the English root, never the browser's.
	const prefix = event.params.lang;
	const locale = site ? (isLocale(prefix) ? prefix : BASE_LOCALE) : requestLocale(event.request);
	// The worker caches the /app shell and the Android build bakes in the static fallback: the client names their language.
	const shell = event.route.id?.startsWith('/app') === true || (building && !site);
	return store.run(locale, () =>
		resolve(event, {
			transformPageChunk: ({ html }) => html.replace('%lang%', shell ? '' : locale)
		})
	);
};
