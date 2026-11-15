import { readFileSync } from 'node:fs';

import common from '../../src/lib/i18n/common.ts';
import email from '../../src/lib/i18n/email.ts';
import errors from '../../src/lib/i18n/errors.ts';
import home from '../../src/lib/i18n/home.ts';
import importing from '../../src/lib/i18n/importing.ts';
import login from '../../src/lib/i18n/login.ts';
import names from '../../src/lib/i18n/names.ts';
import shell from '../../src/lib/i18n/shell.ts';
import views from '../../src/lib/i18n/views.ts';
import { expect, freshEmail, test } from './harness.ts';

function pasteText(text: string): void {
	const data = new DataTransfer();
	data.setData('text/plain', text);
	(document.activeElement ?? document.body).dispatchEvent(
		new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
	);
}

function loggedSubject(to: string): string | undefined {
	return readFileSync(test.info().project.metadata.log, 'utf8')
		.split('\n')
		.findLast((line) => line.startsWith('[email]') && line.includes(` to ${to}`))
		?.match(/skipping "(.*)" to /u)?.[1];
}

test.describe('in fr-FR', () => {
	test.use({ locale: 'fr-FR' });

	test('the app speaks French, counts in French and sends its language', async ({
		page,
		account
	}) => {
		void account;
		const sent = page.waitForRequest((request) => request.url().includes('/api/'));
		await page.goto('/app');
		await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
		expect((await sent).headers()['accept-language']).toBe('fr');
		await expect(page.getByText(home.fr.noTables)).toBeVisible();

		await page.evaluate(pasteText, 'Squat\t100\nBench\t80');
		const sheet = page.getByRole('dialog', { name: importing.fr.title });
		await sheet.getByRole('button', { name: importing.fr.import, exact: true }).click();

		const name = names.fr.table(1);
		await expect(page.getByRole('status')).toContainText(importing.fr.imported(2, name));
		await expect(
			page.getByRole('banner').getByText(shell.fr.rowCount(2), { exact: true })
		).toBeVisible();
		await expect(page.getByRole('columnheader', { name: names.fr.column(2) })).toBeVisible();
		await expect(page.getByRole('link', { name: names.fr.views.grid })).toBeVisible();
		await expect(page).toHaveTitle(`${name} · Torsel`);

		const controls = page.locator('header a, header button, [role="group"] a');
		expect(await controls.count()).toBeGreaterThan(4);
		const clipped = await controls.evaluateAll((elements) =>
			elements
				.filter((element) => element.scrollWidth > element.clientWidth + 1)
				.map((element) => element.textContent?.trim())
		);
		expect(clipped, 'French labels fit their controls').toEqual([]);
	});

	test('the view sheet fits its French labels', async ({ page, account }) => {
		void account;
		await page.goto('/app');
		await page.getByRole('button', { name: home.fr.newTable }).first().click();
		await page.getByRole('button', { name: common.fr.more }).last().click();
		await page
			.getByRole('menuitem', { name: views.fr.viewSettings })
			.or(page.getByRole('dialog').getByRole('button', { name: views.fr.viewSettings }))
			.click();
		const picker = page.getByRole('group', { name: views.fr.viewType });
		await expect(picker.getByRole('button')).toHaveCount(4);
		const clipped = await picker
			.getByRole('button')
			.evaluateAll((buttons) =>
				buttons
					.filter((button) => button.scrollWidth > button.clientWidth + 1)
					.map((button) => button.textContent?.trim())
			);
		expect(clipped).toEqual([]);
	});

	test('an empty table counts 0 as singular', async ({ page, account }) => {
		void account;
		await page.goto('/app');
		await page.getByRole('button', { name: home.fr.newTable }).first().click();
		await expect(
			page.getByRole('banner').getByText(shell.fr.rowCount(0), { exact: true })
		).toBeVisible();
		expect(shell.fr.rowCount(0)).toBe('0 ligne');
	});

	test('the consent sentence keeps its links in French order', async ({ page }) => {
		await page.goto('/app/login');
		const consent = page.getByText(/^En continuant/u);
		await expect(consent).toHaveText(login.fr.consent.replace(/<\/?\w+>/gu, ''));
		await expect(consent.getByRole('link', { name: 'conditions' })).toHaveAttribute(
			'href',
			'/terms'
		);
		await expect(
			consent.getByRole('link', { name: 'politique de confidentialité' })
		).toHaveAttribute('href', '/privacy');
	});

	test('the server renders its 404 in French', async ({ page }) => {
		const response = await page.goto('/no-such-page');
		expect(response?.status()).toBe(404);
		await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
		await expect(page.getByRole('heading', { name: home.fr.pageMissing })).toBeVisible();
	});

	test('a sign-up email goes out in French', async ({ page }) => {
		const address = freshEmail();
		await page.goto('/app/login');
		await page.getByLabel(login.fr.email).fill(address);
		await page.getByRole('button', { name: login.fr.continue, exact: true }).click();
		await page.getByRole('button', { name: login.fr.createAccount }).click();
		await expect(page.getByRole('heading', { name: login.fr.checkEmail })).toBeVisible();
		await expect.poll(() => loggedSubject(address)).toBe(email.fr.verifySubject);
	});
});

test('an API error follows the language the request asks for', async ({ request }) => {
	const bad = { email: freshEmail(), password: 'not-the-password', client: 'web' };
	const french = await request.post('/api/auth/login', {
		data: bad,
		headers: { 'accept-language': 'fr-FR,fr;q=0.9' }
	});
	expect(french.status()).toBe(401);
	expect(await french.json()).toMatchObject({ message: errors.fr.wrongLogin });

	// Playwright's request fixture sends no Accept-Language, whatever the context's locale.
	const plain = await request.post('/api/auth/login', { data: bad });
	expect(await plain.json()).toMatchObject({ message: errors.en.wrongLogin });
});

test.describe('in de-DE', () => {
	test.use({ locale: 'de-DE' });

	test('a language with no catalog falls back to English', async ({ page, request, account }) => {
		void account;
		await page.goto('/app');
		await expect(page.locator('html')).toHaveAttribute('lang', 'en');
		await expect(page.getByRole('button', { name: home.en.newTable }).first()).toBeVisible();

		const response = await page.goto('/no-such-page');
		expect(response?.status()).toBe(404);
		await expect(page.locator('html')).toHaveAttribute('lang', 'en');
		await expect(page.getByRole('heading', { name: home.en.pageMissing })).toBeVisible();

		const refused = await request.post('/api/auth/login', {
			data: { email: freshEmail(), password: 'x', client: 'web' },
			headers: { 'accept-language': 'de-DE,de;q=0.9' }
		});
		expect(await refused.json()).toMatchObject({ message: errors.en.wrongLogin });
	});
});
