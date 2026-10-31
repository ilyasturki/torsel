import { sitemapXml } from '#lib/site/seo.ts';

export const prerender = !import.meta.env.APP_BUILD;

export function GET(): Response {
	return new Response(sitemapXml(), { headers: { 'content-type': 'application/xml' } });
}
