import { BASE_LOCALE, isLocale, pickLocale, type Locale } from './locale.ts';

const browser = typeof document !== 'undefined';

// A server-rendered page names its language in <html lang>, and hydration must match it.
const pageLocale: Locale | undefined =
	browser && isLocale(document.documentElement.lang) ? document.documentElement.lang : undefined;

const systemLocale: Locale = browser ? pickLocale(navigator.languages) : BASE_LOCALE;

let serverLocale: (() => Locale | undefined) | null = null;

function inApp(): boolean {
	return location.pathname === '/app' || location.pathname.startsWith('/app/');
}

/** The language of the words: never pass it to `Intl`, whose formats follow the full browser locale. */
export function locale(): Locale {
	const server = serverLocale?.();
	if (server !== undefined) return server;
	if (!browser) return BASE_LOCALE;
	return inApp() ? systemLocale : (pageLocale ?? systemLocale);
}

/** The server's per-request locale; `src/lib/server/http/locale.ts` registers it. */
export function readServerLocale(read: () => Locale | undefined): void {
	serverLocale = read;
}

/** `<html lang>` for pages no server named the language of: `/app`, its cached shell, the Android build. */
export function markDocumentLocale(): void {
	if (browser && document.documentElement.lang !== locale()) {
		document.documentElement.lang = locale();
	}
}

/** An area's messages in the current locale, looked up at each access. */
export function area<T extends object>(catalogs: Record<Locale, T>): T {
	return new Proxy(catalogs.en, {
		get: (_target, key) => Reflect.get(catalogs[locale()], key)
	});
}
