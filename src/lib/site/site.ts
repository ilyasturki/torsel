export const SITE_ORIGIN = 'https://torsel.ilyasturki.com';
export const SITE_NAME = 'Torsel';
export const REPOSITORY = 'https://github.com/ilyasturki/torsel';
export const OG_IMAGE = '/og.png';
export const LEGAL_NAME = 'Ilyas Turki EI';
export const LEGAL_REGISTRATION = 'SIREN 939 590 527';
export const CONTACT = 'me@ilyasturki.com';
export const LEGAL_UPDATED = '2026-10-31';

export const SITE_DESCRIPTION =
	'A spreadsheet you just ask. Say what you need and Torsel writes the formula, adds the rows and draws the chart. Works offline, no account to start, open source.';

/** What robots.txt keeps crawlers off and the sitemap leaves out. `/app$`: robots rules match by prefix. */
export const PRIVATE_ROBOTS_RULES = ['/app$', '/app/', '/api/'];

export const PUBLIC_PAGES = ['/', '/privacy', '/terms'];

export function canonical(path: string): string {
	return new URL(path, SITE_ORIGIN).href;
}
