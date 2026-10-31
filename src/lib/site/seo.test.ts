import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { jsonLd, llmsTxt, metaTags, robotsTxt, sitemapXml, structuredData } from './seo.ts';
import { PUBLIC_PAGES, SITE_ORIGIN } from './site.ts';

const metaFor = (key: string): string | undefined => {
	const tags = metaTags({ title: 'Privacy', description: 'What leaves', path: '/privacy' });
	return tags.find((tag) => ('name' in tag ? tag.name : tag.property) === key)?.content;
};

describe('page meta', () => {
	it('points every absolute URL at the canonical origin', () => {
		expect(metaFor('og:url')).toBe(`${SITE_ORIGIN}/privacy`);
		expect(metaFor('og:image')).toBe(`${SITE_ORIGIN}/og.png`);
		expect(metaFor('twitter:image')).toBe(`${SITE_ORIGIN}/og.png`);
	});

	it('names the page before the site', () => {
		expect(metaFor('og:title')).toBe('Privacy · Torsel');
		expect(metaFor('twitter:card')).toBe('summary_large_image');
	});
});

describe('robots.txt', () => {
	const rules = robotsTxt().split('\n');

	it('keeps crawlers off the app without blocking lookalike paths', () => {
		expect(rules).toContain('Disallow: /app$');
		expect(rules).toContain('Disallow: /app/');
		expect(rules).not.toContain('Disallow: /app');
		expect(rules).toContain('Disallow: /api/');
	});

	it('links the sitemap', () => {
		expect(rules).toContain(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`);
	});
});

describe('sitemap.xml', () => {
	it('lists the public pages and nothing of the app', () => {
		const xml = sitemapXml();
		for (const path of PUBLIC_PAGES) {
			expect(xml).toContain(`<loc>${new URL(path, SITE_ORIGIN).href}</loc>`);
		}
		expect(xml).not.toContain('/app');
		expect(xml).not.toContain('/api');
	});
});

describe('structured data', () => {
	it('describes the organization, the site and the application', () => {
		const data = structuredData() as { '@graph': { '@type': string; license?: string }[] };
		expect(data['@graph'].map((node) => node['@type'])).toEqual([
			'Organization',
			'WebSite',
			'SoftwareApplication'
		]);
		expect(data['@graph'][2].license).toContain('MIT');
	});

	it('cannot close the script tag it is inlined in', () => {
		expect(jsonLd({ text: '</script><script>' })).not.toContain('<');
		expect(JSON.parse(jsonLd({ text: '</script>' }))).toEqual({ text: '</script>' });
	});
});

describe('social card', () => {
	it('is the size the meta tags announce', () => {
		const png = readFileSync('static/og.png');
		expect(png.readUInt32BE(16)).toBe(1200);
		expect(png.readUInt32BE(20)).toBe(630);
	});
});

describe('llms.txt', () => {
	it('opens with the name and a summary and links the app', () => {
		const text = llmsTxt();
		expect(text.startsWith('# Torsel\n\n> ')).toBe(true);
		expect(text).toContain(`${SITE_ORIGIN}/app`);
	});
});
