import names from '../../src/lib/i18n/names.ts';
import type { APIRequestContext, Page } from '@playwright/test';

import { createBase, createTable, defaultViews, insertRows } from '../../src/lib/core/actions.ts';
import { expect, script, seed, tablePath, test } from './harness.ts';

const FAKE = process.env.TORSEL_TEST_FAKE ?? '';

/** A table the fake model knows by its name, which holds the script's key. */
function seedSets(request: APIRequestContext, key: string): Promise<string> {
	return seed(request, (ws, commit) => {
		const base = createBase(ws, 'Gym');
		commit(base.changes);
		const table = createTable(
			ws,
			base.id,
			`Sets ${key}`,
			[
				{ name: 'Exercise', type: 'text' },
				{ name: 'Reps', type: 'number' },
				{ name: 'Kg', type: 'number' }
			],
			() => defaultViews(names.en)
		);
		commit(table.changes);
		const [exercise, reps, kg] = table.fieldIds;
		commit(insertRows(ws, table.id, [{ [exercise]: 'Bench', [reps]: 8, [kg]: 80 }]).changes);
		return table.id;
	});
}

async function openAsk(page: Page, label = 'Ask'): Promise<void> {
	const asker = page.locator('#ask-input');
	if (!(await asker.isVisible())) {
		await page.getByRole('button', { name: new RegExp(`^${label}`, 'u') }).click();
	}
}

test('an empty thread offers requests on the open table: a question sends, a log waits for its values', async ({
	page,
	context,
	account
}) => {
	void account;
	const key = await script(
		context.request,
		[{ blocks: [{ type: 'text', text: '80 kg, for 8 reps.' }] }],
		undefined,
		[
			{ text: 'Log Bench', complete: false },
			{ text: 'My best set on Bench?', complete: true },
			{ text: 'Chart Kg by week', complete: true }
		]
	);
	const table = await seedSets(context.request, key);
	await page.goto(tablePath(table));
	await openAsk(page);

	const offered = page.getByRole('list', { name: 'Suggestions' });
	await expect(offered.getByRole('button')).toHaveText([
		'Log Bench',
		'My best set on Bench?',
		'Chart Kg by week'
	]);

	await offered.getByRole('button', { name: 'Log Bench' }).click();
	await expect(page.locator('#ask-input')).toHaveValue('Log Bench ');
	await expect(page.locator('#ask-input')).toBeFocused();
	await expect(offered).toHaveCount(0);

	await page.locator('#ask-input').fill('');
	await offered.getByRole('button', { name: 'My best set on Bench?' }).click();
	await expect(page.getByTestId('thread').getByText('80 kg, for 8 reps.')).toBeVisible();
	await expect(offered).toHaveCount(0);

	const { suggests } = (await (await context.request.get(`${FAKE}/__seen?key=${key}`)).json()) as {
		suggests: { messages: { content: string }[] }[];
	};
	expect(suggests).toHaveLength(1);
	const told = suggests[0].messages[0].content;
	expect(told).toContain('<language>English</language>');
	expect(told).toContain('"Exercise":"Bench"');
});

test('a screen with nothing to offer leaves the thread blank, and a new thread asks once', async ({
	page,
	context,
	account
}) => {
	void account;
	const key = await script(context.request, [], undefined, []);
	const table = await seedSets(context.request, key);
	await page.goto(tablePath(table));
	await openAsk(page);
	await expect(page.locator('#ask-input')).toBeVisible();
	await expect(page.getByRole('list', { name: 'Suggestions' })).toHaveCount(0);
	await page.getByRole('button', { name: 'New', exact: true }).click();
	const { suggests } = (await (await context.request.get(`${FAKE}/__seen?key=${key}`)).json()) as {
		suggests: unknown[];
	};
	expect(suggests).toHaveLength(1);
});

test.describe('fr-FR', () => {
	test.use({ locale: 'fr-FR' });

	test('the requests are asked for in French', async ({ page, context, account }) => {
		void account;
		const key = await script(context.request, [], undefined, [
			{ text: 'Note Bench', complete: false }
		]);
		const table = await seedSets(context.request, key);
		await page.goto(tablePath(table));
		await openAsk(page, 'Demander');
		await expect(page.getByRole('list', { name: 'Suggestions' }).getByRole('button')).toHaveText([
			'Note Bench'
		]);
		const { suggests } = (await (
			await context.request.get(`${FAKE}/__seen?key=${key}`)
		).json()) as {
			suggests: { messages: { content: string }[] }[];
		};
		expect(suggests[0].messages[0].content).toContain('<language>French</language>');
	});
});
