import { expect, RETRY_RESET, test } from './harness.ts';

const ORIGIN = 'https://torsel.ilyasturki.com';

test('a french browser is sent to /fr on its first visit only', async ({ request }) => {
	const french = { 'accept-language': 'fr-FR,fr;q=0.9,en;q=0.8' };
	const first = await request.get('/privacy?from=x', {
		...RETRY_RESET,
		headers: french,
		maxRedirects: 0
	});
	expect(first.status()).toBe(307);
	expect(first.headers()['location']).toBe('/fr/privacy?from=x');
	expect(first.headers()['vary']).toContain('accept-language');
	const cookie = first.headers()['set-cookie'] ?? '';
	expect(cookie).toContain('torsel_visited=1');

	const again = await request.get('/privacy', {
		...RETRY_RESET,
		headers: { ...french, cookie: 'torsel_visited=1' },
		maxRedirects: 0
	});
	expect(again.status()).toBe(200);

	const english = await request.get('/', {
		...RETRY_RESET,
		headers: { 'accept-language': 'en-US,fr;q=0.5' },
		maxRedirects: 0
	});
	expect(english.status()).toBe(200);
});

test('the french home names its language, its twin and its own card', async ({ request }) => {
	const response = await request.get('/fr', RETRY_RESET);
	expect(response.status()).toBe(200);
	const html = await response.text();
	expect(html).toContain('<html lang="fr"');
	expect(html).toContain('Le tableur qui fait ce que tu demandes.');
	expect(html).toContain(`<link rel="canonical" href="${ORIGIN}/fr"`);
	expect(html).toContain(`<link rel="alternate" hreflang="en" href="${ORIGIN}/"`);
	expect(html).toContain(`<link rel="alternate" hreflang="fr" href="${ORIGIN}/fr"`);
	expect(html).toContain(`<link rel="alternate" hreflang="x-default" href="${ORIGIN}/"`);
	expect(html).toContain('property="og:locale" content="fr_FR"');
	expect(html).toContain(`property="og:image" content="${ORIGIN}/og-fr.png"`);

	const english = await (await request.get('/', RETRY_RESET)).text();
	expect(english).toContain('<html lang="en"');
	expect(english).toContain(`<link rel="alternate" hreflang="fr" href="${ORIGIN}/fr"`);
	expect(english).toContain('property="og:locale" content="en_US"');
});

test('the sitemap lists both languages with their alternates', async ({ request }) => {
	const xml = await (await request.get('/sitemap.xml', RETRY_RESET)).text();
	expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
	for (const path of ['/fr', '/fr/privacy', '/fr/terms']) {
		expect(xml).toContain(`<loc>${ORIGIN}${path}</loc>`);
	}
	expect(xml).toContain(`hreflang="fr" href="${ORIGIN}/fr/terms"`);
});

test.describe('in french', () => {
	test.use({ locale: 'fr-FR' });

	test('the footer switches language on the same page', async ({ page }) => {
		await page.goto('/fr/terms');
		await expect(page.getByRole('heading', { name: 'Conditions', level: 1 })).toBeVisible();
		await page.getByRole('contentinfo').getByRole('link', { name: 'English' }).click();
		await expect(page).toHaveURL(/\/terms$/u);
		await expect(page.getByRole('heading', { name: 'Terms', level: 1 })).toBeVisible();
		await page.getByRole('contentinfo').getByRole('link', { name: 'Français' }).click();
		await expect(page).toHaveURL(/\/fr\/terms$/u);
	});

	test('the legal pages read in french and link each other', async ({ page }) => {
		await page.goto('/fr/privacy');
		await expect(page.getByRole('heading', { name: 'Confidentialité', level: 1 })).toBeVisible();
		await expect(page).toHaveTitle('Confidentialité · Torsel');
		await expect(page.getByText('Mis à jour le 16 novembre 2026')).toBeVisible();
		await expect(page.getByText('torsel_visited')).toBeVisible();
		await page.getByRole('contentinfo').getByRole('link', { name: 'Conditions' }).click();
		await expect(page).toHaveURL(/\/fr\/terms$/u);
		await page.getByRole('article').getByRole('link', { name: 'confidentialité' }).click();
		await expect(page).toHaveURL(/\/fr\/privacy$/u);
	});

	test('the home shows the demo on french tables and loads no SQLite', async ({ page }) => {
		const wasm: string[] = [];
		page.on('request', (request) => {
			if (request.url().endsWith('.wasm')) wasm.push(request.url());
		});
		await page.goto('/fr');
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(
			'Le tableur qui fait ce que tu demandes.'
		);
		const demo = page.getByTestId('demo');
		await expect(demo.getByRole('gridcell', { name: 'Loyer' })).toBeVisible();
		await expect(demo.getByRole('columnheader', { name: /Par an/u })).toBeInViewport();
		await expect(demo.getByRole('gridcell', { name: '7680' })).toBeVisible();
		await expect(demo.getByTestId('row-count')).toHaveText('6 lignes');
		await expect(
			page
				.getByRole('group', { name: 'Demandes' })
				.getByRole('button', { name: 'Ajoute Netflix 13 et escalade 45, en loisirs.' })
		).toBeVisible();
		await expect(
			page.getByRole('heading', { name: 'Gratuit, hors ligne, open source.' })
		).toBeAttached();
		await page.waitForTimeout(300);
		expect(wasm).toEqual([]);
	});

	test('a prompt on the french demo lands in the french table', async ({ page }) => {
		await page.goto('/fr');
		const demo = page.getByTestId('demo');
		await expect(demo.getByRole('gridcell', { name: 'Loyer' })).toBeVisible();
		await page
			.getByRole('group', { name: 'Demandes' })
			.getByRole('button', { name: 'Ajoute Netflix 13 et escalade 45, en loisirs.' })
			.click();
		await expect(demo.getByTestId('row-count')).toHaveText('8 lignes');
		await expect(demo.getByRole('gridcell', { name: 'Escalade' })).toBeAttached();
	});
});
