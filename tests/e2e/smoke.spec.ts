import { expect, newAccount, test } from './harness.ts';

test('signs in through the form and lands where it was going', async ({ page }) => {
	const { email, password } = newAccount();

	await page.goto('/settings');
	await expect(page).toHaveURL(/\/login\?to=%2Fsettings/u);

	await page.getByLabel('E-mail').fill(email);
	await page.getByLabel('Mot de passe').fill('not the password');
	await page.getByRole('button', { name: 'Se connecter' }).click();
	await expect(page.getByRole('alert')).toBeVisible();

	await page.getByLabel('Mot de passe').fill(password);
	await page.getByRole('button', { name: 'Se connecter' }).click();
	await expect(page).toHaveURL(/\/settings$/u);
});

test('creates a base and a table, adds a row and edits its cell', async ({
	page,
	context,
	account
}) => {
	void account;
	await page.goto('/');

	await page.getByRole('button', { name: 'Nouvelle base' }).click();
	await page.getByRole('textbox', { name: 'Nouvelle base' }).fill('Gym');
	await page.getByRole('button', { name: 'Créer' }).click();
	await expect(page.getByRole('heading', { name: 'Gym' })).toBeVisible();

	await page.getByRole('button', { name: 'Nouvelle table' }).click();
	await page.getByRole('textbox', { name: 'Nouvelle table' }).fill('Lifts');
	await page.getByRole('button', { name: 'Créer' }).click();
	await expect(page.getByRole('heading', { name: 'Lifts' })).toBeVisible();

	await page.getByRole('button', { name: 'Nouvelle ligne' }).click();
	await page.getByRole('dialog').getByLabel('Nom').fill('Squat');
	await page.getByRole('button', { name: 'Enregistrer' }).click();
	const cell = page.getByRole('cell', { name: 'Squat' });
	await expect(cell).toBeVisible();

	await cell.getByRole('button').click();
	await page.getByRole('cell').getByRole('textbox').fill('Bench');
	await page.getByRole('cell').getByRole('textbox').press('Enter');
	await expect(page.getByRole('cell', { name: 'Bench' })).toBeVisible();

	await expect
		.poll(async () => {
			const response = await context.request.post('/api/sync', {
				data: { watermark: 0, push: [] }
			});
			return JSON.stringify(await response.json());
		})
		.toContain('Bench');
});
