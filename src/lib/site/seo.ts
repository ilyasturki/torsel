import {
	OG_IMAGE,
	PRIVATE_ROBOTS_RULES,
	PUBLIC_PAGES,
	REPOSITORY,
	SITE_DESCRIPTION,
	SITE_NAME,
	SITE_ORIGIN,
	canonical
} from './site.ts';

export type PageMeta = { title: string; description: string; path: string };

export type MetaTag = { name: string; content: string } | { property: string; content: string };

/** The page's own name first, then the site's, except on the home page, which is the site. */
export function fullTitle(title: string): string {
	return title === SITE_NAME ? SITE_NAME : `${title} · ${SITE_NAME}`;
}

export function metaTags({ title, description, path }: PageMeta): MetaTag[] {
	const name = fullTitle(title);
	const url = canonical(path);
	const image = canonical(OG_IMAGE);
	return [
		{ name: 'description', content: description },
		{ property: 'og:type', content: 'website' },
		{ property: 'og:site_name', content: SITE_NAME },
		{ property: 'og:title', content: name },
		{ property: 'og:description', content: description },
		{ property: 'og:url', content: url },
		{ property: 'og:image', content: image },
		{ property: 'og:image:width', content: '1200' },
		{ property: 'og:image:height', content: '630' },
		{ property: 'og:image:alt', content: `The ${SITE_NAME} logo` },
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
	const urls = PUBLIC_PAGES.map((path) => `\t<url><loc>${canonical(path)}</loc></url>`);
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
		...urls,
		'</urlset>',
		''
	].join('\n');
}

export function llmsTxt(): string {
	return `# ${SITE_NAME}

> ${SITE_DESCRIPTION}

${SITE_NAME} is a local-first data app. A base holds tables. A field is text, a number, a date, a choice, a check, a link to another table, or a formula, which is a SQLite expression over the row. Each table has views: Grid shows every row, editable in place. Entry adds a row, prefilled from the last row with the same key, with steppers on numbers. List groups rows into cards by a field. Chart draws bars or a line of an aggregate by day, week or month, with an optional rolling average.

SQLite runs as WebAssembly on every device and on the server, so a formula gives the same number everywhere. Every device keeps a full copy of the data and syncs with a server when one is around. The app opens with no account: an account adds sync and the assistant.

The assistant in the app and the MCP server share one set of tools. In the app, data it enters applies at once with an undo, a new table, field or view is proposed before it lands, and a deletion asks first. The server speaks MCP over Streamable HTTP at \`/api/mcp\`, with a token from Settings.

Common uses are budgets, clients, projects, job searches, trips and reading lists. ${SITE_NAME} is MIT licensed and can be self-hosted on NixOS or with Node.

## Links

- [Open the app](${canonical('/app')}): works in the browser with no account
- [Source code and self-hosting guide](${REPOSITORY}): README, NixOS module, MCP setup
- [Privacy](${canonical('/privacy')}): what stays on the device and what leaves it
- [Terms](${canonical('/terms')})
`;
}
