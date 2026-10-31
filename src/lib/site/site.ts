export const SITE_ORIGIN = 'https://torsel.ilyasturki.com';
export const SITE_NAME = 'Torsel';
export const REPOSITORY = 'https://github.com/ilyasturki/torsel';
export const OG_IMAGE = '/og.png';
export const LEGAL_NAME = 'Ilyas Turki EI';
export const LEGAL_REGISTRATION = 'SIREN 939 590 527';
export const CONTACT = 'me@ilyasturki.com';
export const LEGAL_UPDATED = 'October 31, 2026';

export const SITE_DESCRIPTION =
	'Torsel keeps what you track in tables and shows each table the way the moment needs it: a grid at the desk, a one-thumb entry screen at the gym, a chart of where it is going. Offline, no account to start, open source.';

/** What robots.txt keeps crawlers off and the sitemap leaves out. `/app$`: robots rules match by prefix. */
export const PRIVATE_ROBOTS_RULES = ['/app$', '/app/', '/api/'];

export const PUBLIC_PAGES = ['/', '/privacy', '/terms'];

export function canonical(path: string): string {
	return new URL(path, SITE_ORIGIN).href;
}
