import { expect, newAccount, RETRY_RESET, test } from './harness.ts';

test('signs in through the form and lands where it was going', async ({ page }) => {
	const { email, password } = newAccount();

	await page.goto('/app/settings');
	await expect(page).toHaveURL(/\/app\/login\?to=%2Fapp%2Fsettings/u);

	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill('not the password');
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page.getByRole('alert')).toBeVisible();

	await page.getByLabel('Password').fill(password);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page).toHaveURL(/\/app\/settings$/u);
});

test('creates a table, adds a row and edits its cell', async ({ page, context, account }) => {
	void account;
	await page.goto('/app');

	await page.getByRole('button', { name: 'New table' }).first().click();
	await expect(page.getByRole('heading', { name: 'Table 1' })).toBeVisible();

	await page.getByRole('button', { name: 'Add row' }).click();
	await page.getByRole('dialog').getByLabel('Name').fill('Squat');
	await page.getByRole('button', { name: 'Save' }).click();
	const cell = page.getByRole('cell', { name: 'Squat' });
	await expect(cell).toBeVisible();

	await cell.getByRole('button').click();
	await page.getByRole('cell').getByRole('textbox').fill('Bench');
	await page.getByRole('cell').getByRole('textbox').press('Enter');
	await expect(page.getByRole('cell', { name: 'Bench' })).toBeVisible();

	await expect
		.poll(async () => {
			const response = await context.request.post('/api/sync', {
				...RETRY_RESET,
				data: { watermark: 0, push: [] }
			});
			return JSON.stringify(await response.json());
		})
		.toContain('Bench');
});
