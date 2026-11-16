import { expect, openAsk, script, seedLifts, test } from './harness.ts';

const FAKE = process.env.TORSEL_TEST_FAKE ?? '';

const isPhone = (): boolean => test.info().project.name === 'phone';

test('a reply offers one next request: Tab takes it on a desktop, a tap sends it on a phone', async ({
	page,
	context,
	account
}) => {
	void account;
	const next = 'Chart Kg by week';
	const key = await script(
		context.request,
		[
			{ blocks: [{ type: 'text', text: 'Squat, 100 kg.' }] },
			{ blocks: [{ type: 'text', text: 'Here is the chart.' }] }
		],
		undefined,
		undefined,
		next
	);
	await page.goto(await seedLifts(context.request));
	const asker = page.locator('#ask-input');
	if (!(await asker.isVisible())) await openAsk(page);
	await asker.fill(`${key} heaviest lift?`);
	await asker.press('Enter');
	const thread = page.getByTestId('thread');
	await expect(thread.getByText('Squat, 100 kg.')).toBeVisible();

	if (isPhone()) {
		await page.getByTestId('follow-up').click();
	} else {
		await expect(asker).toHaveAttribute('placeholder', next);
		await asker.press('Tab');
		await expect(asker).toHaveValue(`${next} `);
		await asker.press('Enter');
	}
	await expect(thread.getByText(next, { exact: true })).toBeVisible();
	await expect(thread.getByText('Here is the chart.')).toBeVisible();
	await expect(page.getByTestId('follow-up')).toHaveCount(0);

	const { followUps } = (await (await context.request.get(`${FAKE}/__seen?key=${key}`)).json()) as {
		followUps: { messages: { content: string }[] }[];
	};
	expect(followUps.length).toBeGreaterThanOrEqual(1);
	expect(followUps[0].messages[0].content).toContain('<reply>Squat, 100 kg.</reply>');
});

test('no follow-up leaves the box as it was', async ({ page, context, account }) => {
	void account;
	const key = await script(context.request, [{ blocks: [{ type: 'text', text: 'Done.' }] }]);
	await page.goto(await seedLifts(context.request));
	const asker = page.locator('#ask-input');
	if (!(await asker.isVisible())) await openAsk(page);
	await asker.fill(`${key} log a squat`);
	await asker.press('Enter');
	await expect(page.getByTestId('thread').getByText('Done.')).toBeVisible();
	await expect(asker).toHaveAttribute('placeholder', 'Ask about your tables');
	await expect(page.getByTestId('follow-up')).toHaveCount(0);
});
