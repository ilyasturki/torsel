import { expect, openAsk, script, seedLifts, test } from './harness.ts';

test('a sent message saves under a name, comes back behind /, and goes with an undo', async ({
	page,
	context,
	account
}) => {
	void account;
	const key = await script(context.request, [
		{ blocks: [{ type: 'text', text: 'Two sessions.' }] }
	]);
	await page.goto(await seedLifts(context.request));
	const asker = page.locator('#ask-input');
	if (!(await asker.isVisible())) await openAsk(page);
	const text = `${key} sum up my week of lifts`;
	await asker.fill(text);
	await asker.press('Enter');
	const thread = page.getByTestId('thread');
	await expect(thread.getByText('Two sessions.')).toBeVisible();

	await thread.getByRole('button', { name: 'Save as a prompt' }).click();
	const name = thread.getByRole('textbox', { name: 'Prompt name' });
	await expect(name).toBeFocused();
	await name.fill('Weekly review');
	await name.press('Enter');
	await expect(page.getByText('Prompt saved')).toBeVisible();

	const listed = page.getByRole('listbox', { name: 'Saved prompts' });
	await asker.fill('/');
	await expect(listed.getByRole('option')).toHaveText([/Weekly review/u]);
	await asker.fill('/nothing like it');
	await expect(listed).toHaveCount(0);
	await asker.fill('/week');
	await asker.press('Enter');
	await expect(asker).toHaveValue(text);
	await expect(listed).toHaveCount(0);

	await asker.fill('/');
	await asker.press('Escape');
	await expect(asker).toHaveValue('');
	await expect(asker).toBeVisible();

	await asker.fill('/');
	await listed.getByRole('button', { name: 'Delete Weekly review' }).click();
	await expect(listed).toHaveCount(0);
	await page.getByRole('button', { name: 'Undo' }).click();
	await expect(listed.getByRole('option')).toHaveText([/Weekly review/u]);

	await page.reload();
	if (!(await asker.isVisible())) await openAsk(page);
	await asker.fill('/');
	await expect(listed.getByRole('option')).toHaveText([/Weekly review/u]);
});

test.describe('fr-FR', () => {
	test.use({ locale: 'fr-FR' });

	test('saving says so in French', async ({ page, context, account }) => {
		void account;
		const key = await script(context.request, [{ blocks: [{ type: 'text', text: 'Fait.' }] }]);
		await page.goto(await seedLifts(context.request));
		const asker = page.locator('#ask-input');
		if (!(await asker.isVisible())) await page.getByRole('button', { name: /^Demander/u }).click();
		await asker.fill(`${key} bilan`);
		await asker.press('Enter');
		await expect(page.getByTestId('thread').getByText('Fait.')).toBeVisible();
		await page.getByRole('button', { name: 'Enregistrer la demande' }).click();
		await page.getByRole('textbox', { name: 'Nom de la demande' }).press('Enter');
		await expect(page.getByText('Demande enregistrée')).toBeVisible();
		await asker.fill('/');
		await expect(
			page.getByRole('listbox', { name: 'Demandes enregistrées' }).getByRole('option')
		).toHaveCount(1);
	});
});
