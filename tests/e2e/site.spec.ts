import type { Page } from '@playwright/test';

import { expect, RETRY_RESET, test } from './harness.ts';

const ORIGIN = 'https://torsel.ilyasturki.com';

test('serves robots.txt with the app kept out', async ({ request }) => {
	const response = await request.get('/robots.txt', RETRY_RESET);
	expect(response.status()).toBe(200);
	expect(response.headers()['content-type']).toContain('text/plain');
	const rules = (await response.text()).split('\n');
	expect(rules).toContain('Disallow: /app$');
	expect(rules).toContain('Disallow: /app/');
	expect(rules).toContain('Disallow: /api/');
	expect(rules).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
});

test('serves a sitemap of the public pages only', async ({ request }) => {
	const response = await request.get('/sitemap.xml', RETRY_RESET);
	expect(response.status()).toBe(200);
	expect(response.headers()['content-type']).toContain('xml');
	const xml = await response.text();
	for (const path of ['/', '/privacy', '/terms']) {
		expect(xml).toContain(`<loc>${ORIGIN}${path}</loc>`);
	}
	expect(xml).not.toContain('/app');
});

test('serves llms.txt', async ({ request }) => {
	const response = await request.get('/llms.txt', RETRY_RESET);
	expect(response.status()).toBe(200);
	expect(await response.text()).toMatch(/^# Torsel\n/u);
});

test('renders the home page with its meta and structured data', async ({ request }) => {
	const response = await request.get('/', RETRY_RESET);
	expect(response.status()).toBe(200);
	const html = await response.text();
	expect(html).toContain('<html lang="en">');
	expect(html).toContain(`<link rel="canonical" href="${ORIGIN}/"`);
	expect(html).toContain(`property="og:image" content="${ORIGIN}/og.png"`);
	expect(html).toContain('name="twitter:card" content="summary_large_image"');

	const script = /<script type="application\/ld\+json">(.*?)<\/script>/su.exec(html);
	expect(script, 'the JSON-LD block').not.toBeNull();
	const data = JSON.parse(script?.[1] ?? '{}') as { '@graph': { '@type': string }[] };
	expect(data['@graph'].map((node) => node['@type'])).toEqual([
		'Organization',
		'WebSite',
		'SoftwareApplication'
	]);
});

test('keeps the app and sign-in noindexed', async ({ request }) => {
	for (const path of ['/app', '/app/login', '/app/settings']) {
		const response = await request.get(path, { ...RETRY_RESET, maxRedirects: 0 });
		expect(response.headers()['x-robots-tag'], path).toBe('noindex');
	}
	const home = await request.get('/', RETRY_RESET);
	expect(home.headers()['x-robots-tag']).toBeUndefined();
});

test('renders the legal pages', async ({ page }) => {
	await page.goto('/privacy');
	await expect(page.getByRole('heading', { name: 'Privacy', level: 1 })).toBeVisible();
	await expect(page).toHaveTitle('Privacy · Torsel');
	await expect(page.getByText('Anthropic', { exact: false }).first()).toBeVisible();

	await page.getByRole('contentinfo').getByRole('link', { name: 'Terms' }).click();
	await expect(page.getByRole('heading', { name: 'Terms', level: 1 })).toBeVisible();
	await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href', `${ORIGIN}/terms`);
});

test('shows signed-out visitors a way in and signed-in ones the way back', async ({
	page,
	context,
	account
}) => {
	void account;
	await page.goto('/privacy');
	const header = page.getByRole('banner');
	await expect(header.getByRole('link', { name: 'Open Torsel' })).toBeVisible();
	await expect(header.getByRole('link', { name: 'Sign in' })).toBeHidden();

	await context.clearCookies();
	await page.reload();
	await expect(header.getByRole('link', { name: 'Sign in' })).toBeVisible();
	await expect(header.getByRole('link', { name: 'Open Torsel' })).toBeHidden();
});

async function headerPlace(page: Page): Promise<unknown> {
	const header = page.getByRole('banner');
	await expect(header.locator('svg').first()).toBeVisible();
	const [box, mark, last] = await Promise.all([
		header.boundingBox(),
		header.locator('svg').first().boundingBox(),
		header.locator('a:visible, button:visible').last().boundingBox()
	]);
	return {
		height: box?.height,
		width: box?.width,
		mark: [mark?.x, mark?.y],
		end: (last?.x ?? 0) + (last?.width ?? 0)
	};
}

test('keeps the header still from the site into the app', async ({ page }) => {
	await page.goto('/');
	const site = await headerPlace(page);
	await page.getByRole('banner').getByRole('link', { name: 'Start now' }).click();
	await expect(page).toHaveURL(/\/app$/u);
	expect(await headerPlace(page)).toEqual(site);
});

test('keeps the header still when a signed-in visitor opens Torsel', async ({ page, account }) => {
	void account;
	await page.goto('/');
	const open = page.getByRole('banner').getByRole('link', { name: 'Open Torsel' });
	await expect(open).toBeVisible();
	const site = await headerPlace(page);
	await open.click();
	await expect(page).toHaveURL(/\/app$/u);
	expect(await headerPlace(page)).toEqual(site);
});

test('answers an unknown address with a real error page', async ({ page }) => {
	const response = await page.goto('/no-such-page');
	expect(response?.status()).toBe(404);
	await expect(page.getByText('404', { exact: true })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'This page does not exist' })).toBeVisible();
	await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', 'noindex');

	await page.getByRole('link', { name: 'Back to the home page' }).click();
	await expect(page).toHaveURL(/\/$/u);
});

test('keeps an unknown app address inside the app', async ({ page, account }) => {
	void account;
	await page.goto('/app/no-such-page');
	await expect(page.getByRole('heading', { name: 'Nothing at this address' })).toBeVisible();
	await expect(page.getByRole('banner').getByRole('link', { name: 'All tables' })).toBeVisible();

	await page.getByRole('link', { name: 'Back to your tables' }).click();
	await expect(page).toHaveURL(/\/app$/u);
});
