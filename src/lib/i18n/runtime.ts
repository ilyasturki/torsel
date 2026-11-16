import { BASE_LOCALE, formatTag, isLocale, pickLocale, type Locale } from './locale.ts';

const browser = typeof document !== 'undefined';

// A server-rendered page names its language in <html lang>, and hydration must match it.
const pageLocale: Locale | undefined =
	browser && isLocale(document.documentElement.lang) ? document.documentElement.lang : undefined;

const systemLocale: Locale = browser ? pickLocale(navigator.languages) : BASE_LOCALE;

let serverLocale: (() => Locale | undefined) | null = null;
let serverTags: (() => readonly string[] | undefined) | null = null;
const browserTags = new Map<Locale, string>();

function inApp(): boolean {
	return location.pathname === '/app' || location.pathname.startsWith('/app/');
}

/** The language of the words: `Intl` takes `formatLocale()`, which also names the region. */
export function locale(): Locale {
	const server = serverLocale?.();
	if (server !== undefined) return server;
	if (!browser) return BASE_LOCALE;
	return inApp() ? systemLocale : (pageLocale ?? systemLocale);
}

/** The locale numbers, dates and currencies follow: the system's first one in the words' language. */
export function formatLocale(): string {
	const language = locale();
	const server = serverTags?.();
	if (server !== undefined) return formatTag(server, language);
	if (!browser) return formatTag([], language);
	let tag = browserTags.get(language);
	if (tag === undefined) {
		tag = formatTag(navigator.languages, language);
		browserTags.set(language, tag);
	}
	return tag;
}

/** The server's per-request locale; `src/lib/server/http/locale.ts` registers it. */
export function readServerLocale(read: () => Locale | undefined): void {
	serverLocale = read;
}

/** The request's `Accept-Language` tags, for `formatLocale()` on the server. */
export function readServerTags(read: () => readonly string[] | undefined): void {
	serverTags = read;
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
