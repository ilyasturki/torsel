import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
	alternates,
	jsonLd,
	llmsTxt,
	metaTags,
	robotsTxt,
	sitemapXml,
	structuredData
} from './seo.ts';
import { PUBLIC_PAGES, SITE_ORIGIN, basePath, localePath, pathLocale } from './site.ts';

const metaFor = (key: string, locale: 'en' | 'fr' = 'en'): string | undefined => {
	const tags = metaTags({ title: 'Privacy', description: 'What leaves', path: '/privacy', locale });
	return tags.find((tag) => ('name' in tag ? tag.name : tag.property) === key)?.content;
};

describe('page meta', () => {
	it('points every absolute URL at the canonical origin', () => {
		expect(metaFor('og:url')).toBe(`${SITE_ORIGIN}/privacy`);
		expect(metaFor('og:image')).toBe(`${SITE_ORIGIN}/og.png`);
		expect(metaFor('twitter:image')).toBe(`${SITE_ORIGIN}/og.png`);
	});

	it('gives the french page its own address, image and locale', () => {
		expect(metaFor('og:url', 'fr')).toBe(`${SITE_ORIGIN}/fr/privacy`);
		expect(metaFor('og:image', 'fr')).toBe(`${SITE_ORIGIN}/og-fr.png`);
		expect(metaFor('og:locale', 'fr')).toBe('fr_FR');
		expect(metaFor('og:locale:alternate', 'fr')).toBe('en_US');
		expect(metaFor('og:locale')).toBe('en_US');
	});

	it('lists every language of a page and the english one as the default', () => {
		expect(alternates('/')).toEqual([
			{ hreflang: 'en', href: `${SITE_ORIGIN}/` },
			{ hreflang: 'fr', href: `${SITE_ORIGIN}/fr` },
			{ hreflang: 'x-default', href: `${SITE_ORIGIN}/` }
		]);
	});

	it('maps a page between its english and french addresses', () => {
		expect(localePath('fr', '/')).toBe('/fr');
		expect(localePath('fr', '/terms')).toBe('/fr/terms');
		expect(localePath('en', '/terms')).toBe('/terms');
		expect(basePath('/fr')).toBe('/');
		expect(basePath('/fr/privacy')).toBe('/privacy');
		expect(basePath('/privacy')).toBe('/privacy');
		expect(basePath('/french')).toBe('/french');
		expect(pathLocale('/fr/terms')).toBe('fr');
		expect(pathLocale('/french')).toBe('en');
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
			expect(xml).toContain(`<loc>${new URL(localePath('fr', path), SITE_ORIGIN).href}</loc>`);
		}
		expect(xml.match(/<url>/gu)).toHaveLength(PUBLIC_PAGES.length * 2);
		expect(xml.match(/hreflang="x-default"/gu)).toHaveLength(PUBLIC_PAGES.length * 2);
		expect(xml).not.toContain('/app');
		expect(xml).not.toContain('.com/api');
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
