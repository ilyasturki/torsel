import type { Page } from '@playwright/test';
import { chromium } from '@playwright/test';

import { newAccount } from './harness.ts';

const ROUTES = ['/', '/app', '/app/settings', '/app/t/warm'];

// Vite's dependency discovery reloads a first visit mid-navigation: pay it once per server here.
export default async function globalSetup(): Promise<void> {
	const browser = await chromium.launch();

	const web = process.env.TORSEL_TEST_BASE ?? '';
	const signedIn = await browser.newContext({ baseURL: web });
	const account = newAccount();
	await signedIn.request.post('/api/auth/login', {
		data: { email: account.email, password: account.password, client: 'web' }
	});
	await visit(await signedIn.newPage(), ['/app/login', ...ROUTES]);

	const app = await browser.newContext({ baseURL: process.env.TORSEL_TEST_APP_BASE });
	await visit(await app.newPage(), ROUTES);

	await browser.close();
}

async function visit(page: Page, paths: string[]): Promise<void> {
	for (const path of paths) {
		for (let attempt = 0; attempt < 5; attempt += 1) {
			try {
				await page.goto(path, { waitUntil: 'networkidle' });
				break;
			} catch {
				await page.waitForTimeout(1000);
			}
		}
	}
}
