import { site } from '#lib/i18n/site.ts';

import {
	OG_IMAGE,
	OG_LOCALE,
	PRIVATE_ROBOTS_RULES,
	PUBLIC_PAGES,
	REPOSITORY,
	SITE_DESCRIPTION,
	SITE_NAME,
	SITE_LOCALES,
	SITE_ORIGIN,
	canonical,
	localePath,
	type SiteLocale
} from './site.ts';

/** `path` is the page's English address; the locale's own follows from it. */
export type PageMeta = { title: string; description: string; path: string; locale: SiteLocale };

export type MetaTag = { name: string; content: string } | { property: string; content: string };

/** The page's own name first, then the site's, except on the home page, which is the site. */
export function fullTitle(title: string): string {
	return title === SITE_NAME ? SITE_NAME : `${title} · ${SITE_NAME}`;
}

/** Every language's version of a page, and the English one again for browsers in neither. */
export function alternates(path: string): { hreflang: string; href: string }[] {
	return [
		...SITE_LOCALES.map((locale) => ({
			hreflang: locale,
			href: canonical(localePath(locale, path))
		})),
		{ hreflang: 'x-default', href: canonical(path) }
	];
}

export function metaTags({ title, description, path, locale }: PageMeta): MetaTag[] {
	const name = fullTitle(title);
	const url = canonical(localePath(locale, path));
	const image = canonical(OG_IMAGE[locale]);
	return [
		{ name: 'description', content: description },
		{ property: 'og:type', content: 'website' },
		{ property: 'og:site_name', content: SITE_NAME },
		{ property: 'og:title', content: name },
		{ property: 'og:description', content: description },
		{ property: 'og:url', content: url },
		{ property: 'og:locale', content: OG_LOCALE[locale] },
		...SITE_LOCALES.filter((other) => other !== locale).map((other) => ({
			property: 'og:locale:alternate',
			content: OG_LOCALE[other]
		})),
		{ property: 'og:image', content: image },
		{ property: 'og:image:width', content: '1200' },
		{ property: 'og:image:height', content: '630' },
		{ property: 'og:image:alt', content: site.logoAlt },
		{ name: 'twitter:card', content: 'summary_large_image' },
		{ name: 'twitter:title', content: name },
		{ name: 'twitter:description', content: description },
		{ name: 'twitter:image', content: image }
	];
}

export function structuredData(): object {
	const organization = `${SITE_ORIGIN}/#organization`;
	return {
		'@context': 'https://schema.org',
		'@graph': [
			{
				'@type': 'Organization',
				'@id': organization,
				name: SITE_NAME,
				url: SITE_ORIGIN,
				logo: canonical('/icon-512.png'),
				sameAs: [REPOSITORY]
			},
			{
				'@type': 'WebSite',
				'@id': `${SITE_ORIGIN}/#website`,
				name: SITE_NAME,
				url: SITE_ORIGIN,
				publisher: { '@id': organization }
			},
			{
				'@type': 'SoftwareApplication',
				name: SITE_NAME,
				url: SITE_ORIGIN,
				description: SITE_DESCRIPTION,
				applicationCategory: 'ProductivityApplication',
				operatingSystem: 'Web, Android',
				license: 'https://opensource.org/licenses/MIT',
				isAccessibleForFree: true,
				offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
				publisher: { '@id': organization }
			}
		]
	};
}

/** `</script>` inside a string would end the tag it is inlined in. */
export function jsonLd(data: object): string {
	return JSON.stringify(data).replaceAll('<', '\\u003c');
}

export function structuredDataTag(): string {
	return `<script type="application/ld+json">${jsonLd(structuredData())}</script>`;
}

export function robotsTxt(): string {
	return [
		'User-agent: *',
		'Allow: /',
		...PRIVATE_ROBOTS_RULES.map((rule) => `Disallow: ${rule}`),
		'',
		`Sitemap: ${canonical('/sitemap.xml')}`,
		''
	].join('\n');
}

export function sitemapXml(): string {
	const urls = PUBLIC_PAGES.flatMap((path) =>
		SITE_LOCALES.map((locale) =>
			[
				`\t<url><loc>${canonical(localePath(locale, path))}</loc>`,
				...alternates(path).map(
					({ hreflang, href }) =>
						`\t\t<xhtml:link rel="alternate" hreflang="${hreflang}" href="${href}"/>`
				),
				'\t</url>'
			].join('\n')
		)
	);
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
		...urls,
		'</urlset>',
		''
	].join('\n');
}

export function llmsTxt(): string {
	return `# ${SITE_NAME}

> ${SITE_DESCRIPTION}

${SITE_NAME} is a local-first data app. A base holds tables. A field holds text or notes, a number, an amount of money, a percent, a rating, a duration, a date or a date and time, one choice or several, a check, a link to another table's row, a URL, an email, a phone number, or a formula, which is a SQLite expression over the row. Each table has views: Grid shows every row, editable in place. Entry adds a row, prefilled from the last row with the same key, with steppers on numbers. List groups rows into cards by a field. Chart draws bars or a line of an aggregate by day, week or month, with an optional rolling average.

SQLite runs as WebAssembly on every device and on the server, so a formula gives the same number everywhere. Every device keeps a full copy of the data and syncs with a server when one is around. The app opens with no account: an account adds sync and the assistant.

The assistant in the app and the MCP server share one set of tools. In the app, every change it makes applies at once and shows as a before and after you can undo. The server speaks MCP over Streamable HTTP at \`/api/mcp\`, with a token from Settings that reads only, or reads and writes.

Common uses are budgets, clients, projects, job searches, trips and reading lists. ${SITE_NAME} is MIT licensed and can be self-hosted on NixOS or with Node.

## Links

- [Open the app](${canonical('/app')}): works in the browser with no account
- [Source code and self-hosting guide](${REPOSITORY}): README, NixOS module, MCP setup
- [Privacy](${canonical('/privacy')}): what stays on the device and what leaves it
- [Terms](${canonical('/terms')})
`;
}
