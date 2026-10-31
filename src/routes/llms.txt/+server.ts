import { llmsTxt } from '#lib/site/seo.ts';

export const prerender = !import.meta.env.APP_BUILD;

export function GET(): Response {
	return new Response(llmsTxt(), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
