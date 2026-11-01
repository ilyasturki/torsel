import type { Page } from '@playwright/test';

import { DAILY_LIMIT } from './fake-anthropic.ts';
import { askButton, askPanel, expect, script, seedLifts, test } from './harness.ts';

const FAKE = process.env.TORSEL_TEST_FAKE ?? '';

const REFUSED =
	/^You’ve reached today’s assistant limit\. Ask again tomorrow at \d{1,2}:\d{2}\s[AP]M\.$/u;

async function ask(page: Page, text: string): Promise<void> {
	await page.getByPlaceholder('Ask about your tables').fill(text);
	await page.getByRole('button', { name: 'Send' }).click();
}

test('past the daily limit a prompt never reaches the model, and the thread says when to ask again', async ({
	page,
	context,
	account
}) => {
	void account;
	const path = await seedLifts(context.request);
	const answers = Array.from({ length: DAILY_LIMIT }, (_, at) => `Answer ${at + 1}.`);
	const key = await script(
		context.request,
		answers.map((text) => ({ blocks: [{ type: 'text', text }] }))
	);
	await page.goto(path);
	await askButton(page).click();

	const rows = page.getByTestId('thread');
	for (const [at, answer] of answers.entries()) {
		await ask(page, `${key} question ${at + 1}`);
		await expect(rows.getByText(answer)).toBeVisible();
	}

	await ask(page, `${key} one too many`);
	await expect(rows.getByRole('alert')).toHaveText(REFUSED);
	await expect(rows.getByText(`${key} one too many`)).toBeVisible();
	const seen = await (await context.request.get(`${FAKE}/__seen?key=${key}`)).json();
	expect(seen.requests).toHaveLength(DAILY_LIMIT);

	const field = page.getByPlaceholder('Ask about your tables');
	await expect(field).toBeEditable();
	await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();

	// A new thread is refused before it exists, so the list keeps only the first.
	const panel = askPanel(page);
	await panel.getByRole('button', { name: 'New', exact: true }).click();
	await ask(page, 'a fresh start');
	await expect(rows.getByRole('alert')).toHaveText(REFUSED);
	await panel.getByRole('button', { name: 'Threads' }).click();
	await expect(panel.getByRole('button', { name: /question 1/u })).toBeVisible();
	await expect(panel.getByRole('button', { name: /a fresh start/u })).toHaveCount(0);

	await panel.getByRole('button', { name: 'Close' }).click();
	await expect(page.getByRole('gridcell', { name: 'Squat', exact: true })).toBeVisible();
});
