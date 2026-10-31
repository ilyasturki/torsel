import type { Page } from '@playwright/test';

import { createBase, createTable, insertRows } from '../../src/lib/core/actions.ts';
import {
	expect,
	expireEmailTokens,
	freshEmail,
	mailTo,
	newAccount,
	newAddress,
	passwordField,
	passwordSignIn,
	RETRY_RESET,
	seed,
	signIn,
	test
} from './harness.ts';

const GOOGLE = process.env.TORSEL_TEST_GOOGLE ?? '';
const CHOSEN_PASSWORD = 'a-password-the-user-chose';

async function continueWithEmail(page: Page, email: string): Promise<void> {
	await page.getByLabel('Email').fill(email);
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
}

async function makeTable(page: Page, name = 'Table 1'): Promise<void> {
	await page.getByRole('button', { name: 'New table' }).first().click();
	await expect(page.getByRole('heading', { name })).toBeVisible();
}

function seedLifts(page: Page) {
	return seed(page.context().request, (ws, commit) => {
		const base = createBase(ws, 'Gym');
		commit(base.changes);
		const table = createTable(ws, base.id, 'Lifts', [{ name: 'Name', type: 'text' }]);
		commit(table.changes);
		commit(insertRows(ws, table.id, [{ [table.fieldIds[0]]: 'Squat' }]).changes);
		return table.id;
	});
}

async function serverRecords(page: Page): Promise<string> {
	const response = await page.context().request.post('/api/sync', {
		...RETRY_RESET,
		data: { watermark: 0, push: [] }
	});
	return JSON.stringify(await response.json());
}

function googleProfile(profile: Record<string, unknown>): string {
	return Buffer.from(JSON.stringify(profile)).toString('base64url');
}

async function playGoogle(page: Page, profile: Record<string, unknown>): Promise<void> {
	await page
		.context()
		.addCookies([{ name: 'profile', value: googleProfile(profile), url: GOOGLE }]);
}

test.describe('no account', () => {
	test('the app opens at once and keeps its data, with nothing to sign in to first', async ({
		page
	}) => {
		await page.goto('/app/settings');
		await expect(page).toHaveURL(/\/app\/settings$/u);
		await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);

		await page.goto('/app');
		await makeTable(page);
		await page.waitForTimeout(100);
		await page.reload();

		await expect(page.getByRole('link', { name: 'Table 1' })).toBeVisible();
		await expect(page.getByRole('status')).toHaveCount(0);
	});

	test('one console stays clean: no account is not a 401', async ({ page }) => {
		const answers: number[] = [];
		page.on('response', (response) => {
			if (response.url().endsWith('/api/auth/session')) {
				answers.push(response.status());
			}
		});

		await page.goto('/app');
		await expect(page.getByRole('button', { name: 'New table' }).first()).toBeVisible();
		await expect.poll(() => answers).toEqual([200]);
	});

	test('the session check does not hold the app back', async ({ page }) => {
		await page.route('**/api/auth/session', () => {
			// never answered
		});

		await page.goto('/app');
		await makeTable(page);
	});

	test('the erase leaves a browser as new', async ({ page }) => {
		await page.goto('/app');
		await makeTable(page);
		await page.goto('/app/settings');

		await page.getByRole('button', { name: 'Erase this device' }).click();
		await page.getByRole('button', { name: 'Erase for good' }).click();

		await expect(async () => {
			await page.goto('/app');
			await expect(page.getByRole('link', { name: 'Table 1' })).toHaveCount(0);
		}).toPass();
	});
});

test.describe('sign-up', () => {
	test('with a password, by code, keeps the password and returns where it was going', async ({
		page
	}) => {
		const email = freshEmail();
		await page.goto('/app/login?to=%2Fapp%2Fsettings');
		await continueWithEmail(page, email);

		await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
		await passwordField(page).fill(CHOSEN_PASSWORD);
		await page.getByRole('button', { name: 'Create account' }).click();
		await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

		const { code } = await mailTo(email);
		await page.getByLabel('Digit 1 of 6').fill(code);

		await expect(page).toHaveURL(/\/app\/settings$/u);
		await expect(page.getByText(email)).toBeVisible();

		await page.getByRole('button', { name: 'Sign out' }).click();
		await expect(page.getByText('Signed out')).toBeVisible();
		await page.getByRole('link', { name: 'Sign in', exact: true }).click();
		await passwordSignIn(page, { email, password: CHOSEN_PASSWORD });
		await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
	});

	test('with no password, by link, signs in where it was going', async ({ page }) => {
		const email = freshEmail();
		await page.goto('/app/login?to=%2Fapp%2Fsettings');
		await continueWithEmail(page, email);
		await page.getByRole('button', { name: 'Create account' }).click();

		const { link } = await mailTo(email);
		await page.goto(link ?? '');

		await expect(page).toHaveURL(/\/app\/settings$/u);
		await expect(page.getByText(email)).toBeVisible();
		await expect(page.getByRole('button', { name: 'Set password' })).toBeVisible();
	});

	test('a password planted before the address is proven does not survive another browser', async ({
		page,
		browser,
		baseURL
	}) => {
		const email = freshEmail();
		await page.goto('/app/login');
		await continueWithEmail(page, email);
		await passwordField(page).fill(CHOSEN_PASSWORD);
		await page.getByRole('button', { name: 'Create account' }).click();
		const { link } = await mailTo(email);

		const victim = await browser.newContext({
			baseURL,
			extraHTTPHeaders: { 'x-forwarded-for': newAddress() }
		});
		const owner = await victim.newPage();
		await owner.goto(link ?? '');
		await expect(owner.getByText('its password was removed')).toBeVisible();
		await victim.close();

		const attempt = await page.context().request.post('/api/auth/login', {
			...RETRY_RESET,
			data: { email, password: CHOSEN_PASSWORD, client: 'web' }
		});
		expect(attempt.status()).toBe(401);
	});

	test('a closed server says so and creates nothing', async ({ page }) => {
		await page.route('**/api/auth/config', (route) =>
			route.fulfill({ json: { signUp: false, google: false, emailDelivers: true } })
		);
		await page.goto('/app/login');
		await continueWithEmail(page, freshEmail());

		await expect(page.getByText('This server doesn’t take new accounts.')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Create account' })).toHaveCount(0);
		await page.getByRole('link', { name: 'Keep using Torsel without an account' }).click();
		await expect(page).toHaveURL(/\/app$/u);
	});
});

test.describe('sign-in', () => {
	test('by password, with managers and the toggle looked after', async ({ page }) => {
		const account = newAccount();
		await page.goto('/app/login');

		await expect(page.getByLabel('Email')).toHaveAttribute('autocomplete', 'username');
		await expect(page.getByLabel('Email')).toHaveAttribute('name', 'email');
		await continueWithEmail(page, account.email);

		await expect(page.locator('input[autocomplete="username"]')).toHaveValue(account.email);
		await expect(passwordField(page)).toHaveAttribute('autocomplete', 'current-password');
		await expect(passwordField(page)).toHaveAttribute('type', 'password');
		await page.getByRole('button', { name: 'Show password' }).click();
		await expect(passwordField(page)).toHaveAttribute('type', 'text');
		await page.getByRole('button', { name: 'Hide password' }).click();
		await expect(passwordField(page)).toHaveAttribute('type', 'password');

		await passwordField(page).fill(account.password);
		await page.getByRole('button', { name: 'Sign in', exact: true }).click();
		await expect(page).toHaveURL(/\/app$/u);
	});

	test('by code: a wrong one reads in plain words, a pasted one spreads and submits', async ({
		page
	}) => {
		const account = newAccount();
		await page.goto('/app/login?to=%2Fapp%2Fsettings');
		await continueWithEmail(page, account.email);
		await page.getByRole('button', { name: 'Email me a sign-in link' }).click();

		const { code } = await mailTo(account.email);
		const wrong = code === '000000' ? '000001' : '000000';
		await page.getByLabel('Digit 1 of 6').fill(wrong);
		await expect(page.getByRole('alert')).toHaveText('That code is wrong or has expired.');
		await expect(page.getByLabel('Digit 1 of 6')).toHaveValue('');

		await page.getByLabel('Digit 1 of 6').focus();
		await page.evaluate(
			(text) => {
				const data = new DataTransfer();
				data.setData('text', text);
				document
					.querySelector('input[name="code"]')
					?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
			},
			`${code.slice(0, 3)} ${code.slice(3)}`
		);

		await expect(page).toHaveURL(/\/app\/settings$/u);
		await expect(page.getByText(account.email)).toBeVisible();
	});

	test('by link, back to where it was going', async ({ page }) => {
		const account = newAccount();
		await page.goto('/app/login?to=%2Fapp%2Fsettings');
		await continueWithEmail(page, account.email);
		await page.getByRole('button', { name: 'Email me a sign-in link' }).click();

		const { link } = await mailTo(account.email);
		expect(new URL(link ?? '').origin).toBe(new URL(page.url()).origin);
		await page.goto(link ?? '');

		await expect(page).toHaveURL(/\/app\/settings$/u);
		await expect(page.getByText(account.email)).toBeVisible();
		await expect(page.getByRole('button', { name: 'Change password' })).toBeVisible();
	});

	test('an expired link says so and leads back with its destination', async ({ page }) => {
		const account = newAccount();
		await page.goto('/app/login?to=%2Fapp%2Fsettings');
		await continueWithEmail(page, account.email);
		await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
		const { link } = await mailTo(account.email);

		expireEmailTokens();
		await page.goto(link ?? '');

		await expect(page.getByRole('alert')).toHaveText('This link has expired or was already used.');
		await page.getByRole('link', { name: 'Back to sign in' }).click();
		await expect(page).toHaveURL(/\/app\/login\?to=%2Fapp%2Fsettings$/u);
		await expect(page.getByLabel('Email')).toBeVisible();
	});

	test('a used link reads as expired', async ({ page, browser, baseURL }) => {
		const account = newAccount();
		await page.goto('/app/login');
		await continueWithEmail(page, account.email);
		await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
		const { link } = await mailTo(account.email);
		await page.goto(link ?? '');
		await expect(page).toHaveURL(/\/app$/u);

		const again = await browser.newContext({ baseURL });
		const second = await again.newPage();
		await second.goto(link ?? '');
		await expect(second.getByRole('alert')).toContainText('expired or was already used');
		await again.close();
	});

	test('too many tries read as a sentence', async ({ page }) => {
		test.skip(process.env.TORSEL_TEST_DEV === '1', 'the dev server has one address for the suite');

		await page.goto('/app/login');
		for (let sent = 0; sent < 30; sent += 1) {
			const response = await page.context().request.post('/api/auth/lookup', {
				...RETRY_RESET,
				data: { email: freshEmail() }
			});
			expect(response.ok()).toBe(true);
		}

		await continueWithEmail(page, freshEmail());

		await expect(page.getByRole('alert')).toHaveText(
			'Too many tries. Wait a moment and try again.'
		);
	});

	test('a third mail in an hour is refused, per address', async ({ page }) => {
		const account = newAccount();
		await page.goto('/app/login');
		await continueWithEmail(page, account.email);
		await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
		await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

		for (let sent = 0; sent < 2; sent += 1) {
			await page.context().request.post('/api/auth/login-link', {
				...RETRY_RESET,
				data: { email: account.email }
			});
		}
		await page.getByRole('button', { name: 'send it again' }).click();

		await expect(page.getByRole('alert')).toHaveText(
			'Too many tries. Wait a moment and try again.'
		);
	});

	test('a signed-in visitor is bounced off the page, through the gate', async ({
		page,
		account
	}) => {
		void account;
		await page.goto('/app/login?to=%2Fapp%2Fsettings');
		await expect(page).toHaveURL(/\/app\/settings$/u);

		await page.goto(`/app/login?to=${encodeURIComponent('/\\evil.com')}`);
		await expect(page).toHaveURL(/\/app$/u);

		await page.goto(`/app/login?to=${encodeURIComponent('https://evil.com/app')}`);
		await expect(page).toHaveURL(/\/app$/u);
	});

	test('an off-site destination is dropped on the way out too', async ({ page }) => {
		const account = newAccount();
		await page.goto(`/app/login?to=${encodeURIComponent('/\\evil.com')}`);
		await passwordSignIn(page, account);
		await expect(page).toHaveURL(/\/app$/u);
	});

	test('the consent line links the terms and the privacy policy', async ({ page }) => {
		await page.goto('/app/login');
		await expect(page.getByRole('link', { name: 'terms' })).toHaveAttribute('href', '/terms');
		await expect(page.getByRole('link', { name: 'privacy policy' })).toHaveAttribute(
			'href',
			'/privacy'
		);
	});
});

test.describe('local data at sign-in', () => {
	test('a first sign-in merges local data with the account’s, both ways', async ({ page }) => {
		const account = newAccount();
		await signIn(page.context(), account);
		await seedLifts(page);
		await page.context().clearCookies();

		await page.goto('/app');
		await makeTable(page, 'Table 1');
		await page.goto('/app/login');
		await passwordSignIn(page, account);

		await expect(page.getByRole('link', { name: 'Table 1' }).first()).toBeVisible();
		await expect(page.getByRole('link', { name: 'Lifts' }).first()).toBeVisible();
		await expect.poll(() => serverRecords(page)).toContain('Table 1');
		await expect(page.getByRole('status')).toHaveCount(0);
	});

	test('another account’s synced data gives way to the new account’s', async ({ page }) => {
		const first = newAccount();
		await signIn(page.context(), first);
		await seedLifts(page);
		await page.goto('/app');
		await expect(page.getByRole('link', { name: 'Lifts' }).first()).toBeVisible();

		await page.goto('/app/settings');
		await page.getByRole('button', { name: 'Sign out' }).click();
		await expect(page.getByText('Signed out')).toBeVisible();

		await page.getByRole('link', { name: 'Sign in', exact: true }).click();
		await passwordSignIn(page, newAccount());

		await expect(page.getByRole('link', { name: 'Lifts' })).toHaveCount(0);
		await expect(page.getByRole('status')).toHaveCount(0);
	});

	test('another account’s waiting edits are never pushed into this one', async ({ page }) => {
		const first = newAccount();
		await signIn(page.context(), first);
		await page.goto('/app/settings');
		await page.getByRole('button', { name: 'Sign out' }).click();
		await expect(page.getByText('Signed out')).toBeVisible();

		await page.goto('/app');
		await makeTable(page, 'Table 1');
		await page.goto('/app/login');
		await passwordSignIn(page, newAccount());

		await expect(page.getByRole('status')).toContainText('another account’s data');
		await page.waitForTimeout(1600);
		expect(await serverRecords(page)).not.toContain('Table 1');
	});

	test('signing out stays in the app, keeps the data and asks nothing', async ({
		page,
		account
	}) => {
		void account;
		const table = await seedLifts(page);
		await page.goto(`/app/t/${table}`);
		await expect(page.getByRole('cell', { name: 'Squat' })).toBeVisible();

		await page.goto('/app/settings');
		await page.getByRole('button', { name: 'Sign out' }).click();
		await expect(page.getByText('Your data stays on this device')).toBeVisible();
		await expect(page).toHaveURL(/\/app\/settings$/u);
		await expect(page.getByRole('status', { name: /session/iu })).toHaveCount(0);

		await page.reload();
		await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
		await expect(page.getByRole('status')).toHaveCount(0);

		await page.goto(`/app/t/${table}`);
		await expect(page.getByRole('cell', { name: 'Squat' })).toBeVisible();
		await expect(page.getByRole('status')).toHaveCount(0);
	});

	test('an expired session survives a reload and says the data is safe', async ({
		page,
		context,
		account
	}) => {
		void account;
		await page.goto('/app/settings');
		await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

		await context.clearCookies();
		await page.reload();

		await expect(page.getByRole('status')).toContainText(
			'Session expired, your data stays here, sign in again'
		);
	});

	test('other tabs follow a sign-out and a sign-in', async ({ page, context, account }) => {
		await page.goto('/app/settings');
		await expect(page.getByText(account.email)).toBeVisible();
		const other = await context.newPage();
		await other.goto('/app/settings');
		await expect(other.getByText(account.email)).toBeVisible();

		await page.getByRole('button', { name: 'Sign out' }).click();
		await expect(other.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
		await expect(other.getByRole('status')).toHaveCount(0);

		await page.getByRole('link', { name: 'Sign in', exact: true }).click();
		await passwordSignIn(page, account);
		await expect(other.getByText(account.email)).toBeVisible();
		await other.close();
	});
});

test.describe('Google', () => {
	test('a verified profile signs up and returns where it was going', async ({ page }) => {
		const email = freshEmail();
		await playGoogle(page, { sub: email, email, email_verified: true });

		await page.goto('/app/login?to=%2Fapp%2Fsettings');
		await page.getByRole('link', { name: 'Continue with Google' }).click();

		await expect(page).toHaveURL(/\/app\/settings$/u);
		await expect(page.getByText(email)).toBeVisible();
		await expect(page.getByRole('button', { name: 'Set password' })).toBeVisible();
	});

	test('it joins an existing account, whose password still works', async ({ page }) => {
		const account = newAccount();
		await playGoogle(page, { sub: account.email, email: account.email, email_verified: true });

		await page.goto('/app/login');
		await page.getByRole('link', { name: 'Continue with Google' }).click();
		await expect(page).toHaveURL(/\/app$/u);

		await page.goto('/app/settings');
		await expect(page.getByText(account.email)).toBeVisible();
		await page.getByRole('button', { name: 'Sign out' }).click();
		await expect(page.getByText('Signed out')).toBeVisible();

		await page.getByRole('link', { name: 'Sign in', exact: true }).click();
		await continueWithEmail(page, account.email);
		await expect(page.getByRole('link', { name: 'Continue with Google' })).toBeVisible();
		await passwordField(page).fill(account.password);
		await page.getByRole('button', { name: 'Sign in', exact: true }).click();
		await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
	});

	test('an unverified address is refused and the error does not survive a refresh', async ({
		page
	}) => {
		const email = freshEmail();
		await playGoogle(page, { sub: email, email, email_verified: false });

		await page.goto('/app/login?to=%2Fapp%2Fsettings');
		await page.getByRole('link', { name: 'Continue with Google' }).click();

		await expect(page.getByRole('alert')).toContainText('Google sign-in didn’t go through');
		await expect(page).toHaveURL(/\/app\/login\?to=%2Fapp%2Fsettings$/u);
		await page.reload();
		await expect(page.getByLabel('Email')).toBeVisible();
		await expect(page.getByRole('alert')).toHaveCount(0);
	});

	test('a forged state is refused', async ({ page }) => {
		await page.goto(`/api/auth/google?code=${googleProfile({ sub: 'x' })}&state=forged`);
		await expect(page.getByRole('alert')).toContainText('Google sign-in didn’t go through');
	});

	test('it stays hidden on a server with no client ID', async ({ page }) => {
		await page.route('**/api/auth/config', (route) =>
			route.fulfill({ json: { signUp: true, google: false, emailDelivers: true } })
		);
		await page.goto('/app/login');
		await expect(page.getByLabel('Email')).toBeVisible();
		await expect(page.getByRole('link', { name: 'Continue with Google' })).toHaveCount(0);
	});
});

test.describe('headers', () => {
	test('a page carries the policy, and SQLite still runs under it', async ({ page }) => {
		const response = await page.goto('/app');
		const headers = response?.headers() ?? {};

		test.skip(process.env.TORSEL_TEST_DEV === '1', 'vite dev serves its own policy');
		expect(headers['content-security-policy']).toContain("'wasm-unsafe-eval'");
		expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
		expect(headers['x-content-type-options']).toBe('nosniff');
		expect(headers['x-frame-options']).toBe('DENY');
		expect(headers['referrer-policy']).toBe('same-origin');
		expect(headers['permissions-policy']).toContain('camera=()');

		await makeTable(page);
		await page.getByRole('button', { name: 'Add row' }).click();
		await expect(page.getByRole('dialog')).toBeVisible();
	});

	test('the api answers with them too, and is never cached', async ({ page }) => {
		const response = await page.context().request.get('/api/auth/config', RETRY_RESET);
		const headers = response.headers();

		expect(headers['x-content-type-options']).toBe('nosniff');
		expect(headers['cache-control']).toContain('no-store');
	});
});
