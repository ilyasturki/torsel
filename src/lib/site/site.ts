export const SITE_ORIGIN = 'https://torsel.ilyasturki.com';
export const SITE_NAME = 'Torsel';
export const REPOSITORY = 'https://github.com/ilyasturki/torsel';
export const OG_IMAGE = '/og.png';
export const LEGAL_NAME = 'Ilyas Turki EI';
export const LEGAL_REGISTRATION = 'SIREN 939 590 527';
export const CONTACT = 'me@ilyasturki.com';
export const LEGAL_UPDATED = 'October 31, 2026';

export const SITE_DESCRIPTION =
	"Say what you want to track. Torsel's assistant proposes the table, the form and the chart right on your data, and you keep what you accept. Offline, no account to start, open source.";

/** What robots.txt keeps crawlers off and the sitemap leaves out. `/app$`: robots rules match by prefix. */
export const PRIVATE_ROBOTS_RULES = ['/app$', '/app/', '/api/'];

export const PUBLIC_PAGES = ['/', '/privacy', '/terms'];

export function canonical(path: string): string {
	return new URL(path, SITE_ORIGIN).href;
}
