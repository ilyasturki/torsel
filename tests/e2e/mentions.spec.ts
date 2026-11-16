import names from '../../src/lib/i18n/names.ts';
import type { APIRequestContext, Page } from '@playwright/test';

import { createBase, createTable, defaultViews } from '../../src/lib/core/actions.ts';
import { expect, script, seed, tablePath, test } from './harness.ts';

const FAKE = process.env.TORSEL_TEST_FAKE ?? '';

function seedGym(request: APIRequestContext): Promise<string> {
	return seed(request, (ws, commit) => {
		const base = createBase(ws, 'Gym');
		commit(base.changes);
		const lifts = createTable(
			ws,
			base.id,
			'Lifts',
			[
				{ name: 'Exercise', type: 'text' },
				{ name: 'Kg', type: 'number' }
			],
			() => defaultViews(names.en)
		);
		commit(lifts.changes);
		const weights = createTable(
			ws,
			base.id,
			'Weigh-ins',
			[
				{ name: 'Day', type: 'date' },
				{ name: 'Body kg', type: 'number' }
			],
			() => defaultViews(names.en)
		);
		commit(weights.changes);
		return tablePath(lifts.id);
	});
}

async function openAsk(page: Page, label = 'Ask'): Promise<void> {
	if (!(await page.locator('#ask-input').isVisible())) {
		await page.getByRole('button', { name: new RegExp(`^${label}`, 'u') }).click();
	}
}

test('@ lists tables, then the open table’s fields; a picked table’s schema goes with the message', async ({
	page,
	context,
	account
}) => {
	void account;
	const key = await script(context.request, [{ blocks: [{ type: 'text', text: 'Close.' }] }]);
	await page.goto(await seedGym(context.request));
	await openAsk(page);
	const asker = page.locator('#ask-input');
	const picker = page.getByRole('listbox', { name: 'Tables and fields' });

	await asker.pressSequentially('compare with @');
	await expect(picker.getByRole('option')).toHaveText([
		/^Lifts/u,
		/^Weigh-ins/u,
		/^Exercise/u,
		/^Kg/u
	]);
	await asker.pressSequentially('we');
	await expect(picker.getByRole('option')).toHaveText([/^Weigh-ins/u]);
	await asker.press('Enter');
	await expect(asker).toHaveValue('compare with @Weigh-ins ');
	await expect(picker).toHaveCount(0);

	await asker.pressSequentially('@k');
	await expect(picker.getByRole('option')).toHaveText([/^Kg/u]);
	await asker.press('Escape');
	await expect(picker).toHaveCount(0);
	await expect(asker).toBeVisible();

	await asker.fill(`${key} compare my Kg with @Weigh-ins`);
	await asker.press('Enter');
	await expect(page.getByTestId('thread').getByText('Close.')).toBeVisible();
	const { requests } = (await (await context.request.get(`${FAKE}/__seen?key=${key}`)).json()) as {
		requests: { messages: unknown[] }[];
	};
	expect(JSON.stringify(requests[0].messages.at(-1))).toContain(
		'The message names table \\"Weigh-ins\\"'
	);
});

test.describe('fr-FR', () => {
	test.use({ locale: 'fr-FR' });

	test('the list is named in French', async ({ page, context, account }) => {
		void account;
		await page.goto(await seedGym(context.request));
		await openAsk(page, 'Demander');
		await page.locator('#ask-input').pressSequentially('@');
		await expect(
			page.getByRole('listbox', { name: 'Tables et champs' }).getByRole('option')
		).toHaveCount(4);
	});
});
