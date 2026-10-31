import type { BrowserContext, Page } from '@playwright/test';

import {
	askAddsDeadlift,
	askButton,
	askPanel,
	cell,
	editCell,
	expect,
	redoButton,
	seedLifts,
	test,
	undoButton,
	watchErrors
} from './harness.ts';

async function secondTab(page: Page, context: BrowserContext, errors: string[]): Promise<Page> {
	const other = await context.newPage();
	watchErrors(other, errors);
	await other.goto(page.url());
	await expect(cell(other, 'Squat')).toBeVisible();
	return other;
}

async function noSync(context: BrowserContext): Promise<void> {
	await context.route('**/api/sync', (route) => route.fulfill({ status: 400, json: {} }));
}

test.beforeEach(async ({ page, context, account }) => {
	void account;
	await page.goto(await seedLifts(context.request));
	await expect(cell(page, 'Squat')).toBeVisible();
});

test('a change in one tab shows in the other, with its undo step', async ({
	page,
	context,
	pageErrors
}) => {
	const other = await secondTab(page, context, pageErrors);

	await editCell(page, 'Squat', 'Bench');
	await expect(cell(other, 'Bench')).toBeVisible();

	await undoButton(other).first().click();
	await expect(cell(other, 'Squat')).toBeVisible();
	await expect(cell(page, 'Squat')).toBeVisible();

	await redoButton(page).click();
	await expect(cell(page, 'Bench')).toBeVisible();
	await expect(cell(other, 'Bench')).toBeVisible();
});

test('neither tab overwrites the undo steps of the other', async ({
	page,
	context,
	pageErrors
}) => {
	const other = await secondTab(page, context, pageErrors);

	await editCell(page, 'Squat', 'Bench');
	await expect(undoButton(other).first()).toBeEnabled();
	await editCell(other, '100', '120');
	await expect(cell(page, '120')).toBeVisible();

	await page.reload();
	await undoButton(page).first().click();
	await expect(cell(page, '100')).toBeVisible();
	await undoButton(page).first().click();
	await expect(cell(page, 'Squat')).toBeVisible();
	await expect(undoButton(other).first()).toBeDisabled();
});

test('history a stale tab held never brings back what the other undid', async ({
	page,
	context,
	pageErrors
}) => {
	await askAddsDeadlift(page, context.request);
	await askPanel(page).getByRole('button', { name: 'Close' }).click();
	const other = await secondTab(page, context, pageErrors);

	await undoButton(page).first().click();
	await expect(cell(other, 'Deadlift')).toHaveCount(0);
	await editCell(other, 'Squat', 'Bench');
	await expect(cell(page, 'Bench')).toBeVisible();

	await page.reload();
	await askButton(page).click();
	await expect(page.getByTestId('thread').getByText('Undone', { exact: true })).toBeVisible();
	await expect(page.getByText('1 row', { exact: true })).toBeVisible();
	await expect(redoButton(page)).toBeDisabled();
});

test('a decision in one tab reaches the thread open in the other', async ({
	page,
	context,
	pageErrors
}) => {
	await askAddsDeadlift(page, context.request);
	const other = await secondTab(page, context, pageErrors);
	await askButton(other).click();
	await expect(other.getByTestId('thread').getByText('Applied', { exact: true })).toBeVisible();

	await page.getByTestId('thread').getByRole('button', { name: 'Undo' }).click();

	await expect(other.getByTestId('thread').getByText('Undone', { exact: true })).toBeVisible();
});

test('two tabs editing one row, with no server to mend it, keep both edits on disk', async ({
	page,
	context,
	pageErrors
}) => {
	await noSync(context);
	const other = await secondTab(page, context, pageErrors);

	await editCell(page, 'Squat', 'Bench');
	await expect(cell(other, 'Bench')).toBeVisible();
	await editCell(other, '100', '120');
	await expect(cell(page, '120')).toBeVisible();

	await page.reload();
	await expect(cell(page, 'Bench')).toBeVisible();
	await expect(cell(page, '120')).toBeVisible();
});

test('tabs writing at the same moment end up agreeing, on disk too', async ({
	page,
	context,
	pageErrors
}) => {
	await noSync(context);
	const other = await secondTab(page, context, pageErrors);
	await page.evaluate(() => {
		const { postMessage } = BroadcastChannel.prototype;
		const held: (() => void)[] = [];
		BroadcastChannel.prototype.postMessage = function (message) {
			held.push(() => postMessage.call(this, message));
		};
		(window as unknown as { release: () => void }).release = () => {
			BroadcastChannel.prototype.postMessage = postMessage;
			for (const post of held) post();
		};
	});

	await editCell(page, 'Squat', 'Bench');
	await editCell(other, '100', '120');
	await expect(cell(page, '120')).toBeVisible();
	await page.evaluate(() => (window as unknown as { release: () => void }).release());
	await expect(cell(other, 'Bench')).toBeVisible();

	await undoButton(page).first().click();
	await expect(cell(page, '100')).toBeVisible();
	await expect(cell(other, '100')).toBeVisible();
	await expect(undoButton(page).first()).toBeDisabled();
	await expect(undoButton(other).first()).toBeDisabled();

	await other.reload();
	await expect(cell(other, 'Bench')).toBeVisible();
	await expect(cell(other, '100')).toBeVisible();
});

test('an erase in one tab empties the other', async ({ page, context, pageErrors }) => {
	const other = await secondTab(page, context, pageErrors);

	await page.goto('/app/settings');
	await page.getByRole('button', { name: 'Sign out' }).click();
	await page.getByRole('button', { name: 'Erase this device' }).click();
	await page.getByRole('button', { name: 'Erase for good' }).click();

	await expect(other.getByText('This table no longer exists.')).toBeVisible();
});
