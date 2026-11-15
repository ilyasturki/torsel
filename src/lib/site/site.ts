export const SITE_ORIGIN = 'https://torsel.ilyasturki.com';
export const SITE_NAME = 'Torsel';
export const REPOSITORY = 'https://github.com/ilyasturki/torsel';
export const LEGAL_NAME = 'Ilyas Turki EI';
export const LEGAL_REGISTRATION = 'SIREN 939 590 527';
export const CONTACT = 'me@ilyasturki.com';
export const LEGAL_UPDATED = '2026-11-16';

export const SITE_DESCRIPTION =
	'A spreadsheet you just ask. Say what you need and Torsel writes the formula, adds the rows and draws the chart. It works offline and its code is open.';

/** What robots.txt keeps crawlers off and the sitemap leaves out. `/app$`: robots rules match by prefix. */
export const PRIVATE_ROBOTS_RULES = ['/app$', '/app/', '/api/'];

export const PUBLIC_PAGES = ['/', '/privacy', '/terms'];

export const SITE_LOCALES = ['en', 'fr'] as const;

export type SiteLocale = (typeof SITE_LOCALES)[number];

export const OG_IMAGE: Record<SiteLocale, string> = { en: '/og.png', fr: '/og-fr.png' };

export const OG_LOCALE: Record<SiteLocale, string> = { en: 'en_US', fr: 'fr_FR' };

/** A site page's address in `locale`: English at the root, French under `/fr`. */
export function localePath(locale: SiteLocale, path: string): string {
	if (locale === 'en') return path;
	return path === '/' ? '/fr' : `/fr${path}`;
}

/** The page a site address shows, whatever its language. */
export function basePath(path: string): string {
	if (path === '/fr' || path === '/fr/') return '/';
	return path.startsWith('/fr/') ? path.slice(3) : path;
}

export function pathLocale(path: string): SiteLocale {
	return path === '/fr' || path.startsWith('/fr/') ? 'fr' : 'en';
}

export function canonical(path: string): string {
	return new URL(path, SITE_ORIGIN).href;
}
