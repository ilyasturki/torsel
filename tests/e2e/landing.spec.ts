import type { Page } from '@playwright/test';

import { expect, test } from './harness.ts';

const STAGE = '[data-testid="stage"]';

function wasmRequests(page: Page): string[] {
	const seen: string[] = [];
	page.on('request', (request) => {
		if (request.url().endsWith('.wasm')) seen.push(request.url());
	});
	return seen;
}

test('says what it is and loads no SQLite on the way', async ({ page }) => {
	const wasm = wasmRequests(page);
	await page.goto('/');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(
		'Say what you want to track. Get the table, the form and the chart.'
	);
	await expect(page.getByRole('link', { name: 'Start now' }).first()).toBeVisible();
	await page.getByRole('heading', { name: 'Check it yourself.' }).scrollIntoViewIfNeeded();
	await page.waitForTimeout(300);
	expect(wasm).toEqual([]);
});

test('the call to action reaches a working app with no account', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('main').getByRole('link', { name: 'Start now' }).first().click();
	await expect(page).toHaveURL(/\/app$/u);
	await page.getByRole('button', { name: 'New table' }).first().click();
	await expect(page.getByRole('heading', { name: 'Table 1' })).toBeVisible();
});

test('what the page says about going offline holds', async ({ page, context }) => {
	test.skip(process.env.TORSEL_TEST_DEV === '1', 'the worker is only registered in a build');
	await page.goto('/');
	await expect(page.getByText('Turn off your network. Add a row. Reload.')).toBeVisible();

	await page.goto('/app');
	await page.getByRole('button', { name: 'New table' }).first().click();
	await expect(page.getByRole('heading', { name: 'Table 1' })).toBeVisible();
	await page.getByRole('link', { name: 'Entry' }).click();
	await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));

	await context.setOffline(true);
	await page.getByRole('textbox', { name: 'Name' }).fill('Added offline');
	await page.getByRole('button', { name: 'Add row' }).click();
	await expect(page.getByRole('status')).toContainText('Row added');

	await page.reload();
	await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue('Added offline');
});

test('links the real sign-in, privacy and terms', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('banner').getByRole('link', { name: 'Sign in' })).toHaveAttribute(
		'href',
		'/app/login'
	);
	const footer = page.getByRole('contentinfo');
	await footer.getByRole('link', { name: 'Terms' }).click();
	await expect(page.getByRole('heading', { name: 'Terms', level: 1 })).toBeVisible();
	await page.getByRole('contentinfo').getByRole('link', { name: 'Privacy' }).click();
	await expect(page.getByRole('heading', { name: 'Privacy', level: 1 })).toBeVisible();
});

test('swaps the header for a signed-in visitor', async ({ page, account }) => {
	void account;
	await page.goto('/');
	const header = page.getByRole('banner');
	await expect(header.getByRole('link', { name: 'Open Torsel' })).toBeVisible();
	await expect(header.getByRole('link', { name: 'Sign in' })).toBeHidden();
});

test.describe('with reduced motion', () => {
	test.use({ contextOptions: { reducedMotion: 'reduce' } });

	test('stops the background and shows the finished example', async ({ page }) => {
		await page.addInitScript(() => {
			const raf = window.requestAnimationFrame.bind(window);
			const counter = window as unknown as { rafCount: number };
			counter.rafCount = 0;
			window.requestAnimationFrame = (callback) => {
				counter.rafCount += 1;
				return raf(callback);
			};
		});
		await page.goto('/');
		await expect(page.getByTestId('backdrop')).toBeAttached();
		const stage = page.locator(STAGE);
		await expect(stage.getByTestId('sentence')).toHaveText('Show me where the money goes.');
		await expect(stage.getByText('Total amount')).toBeVisible();

		await page.waitForTimeout(600);
		const count = (): Promise<number> =>
			page.evaluate(() => (window as unknown as { rafCount: number }).rafCount);
		const before = await count();
		await page.waitForTimeout(800);
		expect(await count()).toBe(before);
	});

	test('switching example shows it finished at once', async ({ page }) => {
		await page.goto('/');
		const stage = page.locator(STAGE);
		const clients = stage.getByRole('button', { name: 'Clients', exact: true });
		await clients.click();
		await expect(clients).toHaveAttribute('aria-pressed', 'true');
		await expect(stage.getByRole('button', { name: 'Budget' })).toHaveAttribute(
			'aria-pressed',
			'false'
		);
		await expect(stage.getByTestId('sentence')).toHaveText('Chart the pipeline.');
		await expect(stage.getByText('Total value')).toBeVisible();

		await stage.getByRole('button', { name: 'Step 2' }).click();
		await expect(stage.getByTestId('sentence')).toHaveText(/expected value/u);
		await expect(stage.getByRole('columnheader', { name: /Expected/u })).toBeVisible();
	});
});

test.describe('with motion', () => {
	test.use({ contextOptions: { reducedMotion: 'no-preference' } });

	test('plays one example from a blank sheet and stops on its chart', async ({ page }) => {
		await page.goto('/');
		const stage = page.locator(STAGE);
		await expect(stage.getByTestId('blank-sheet')).toBeVisible();
		await expect(stage.getByTestId('proposal')).toHaveText(/Proposed table: Budget/u, {
			timeout: 10_000
		});
		await expect(stage.getByTestId('ghost-column')).toBeVisible({ timeout: 10_000 });
		await expect(stage.getByTestId('proposal')).toHaveText(/Proposed view/u, { timeout: 10_000 });
		await expect(stage.getByText('Total amount')).toBeVisible({ timeout: 15_000 });
		await expect(stage.getByTestId('proposal')).toBeHidden({ timeout: 10_000 });
		await page.waitForTimeout(1500);
		await expect(stage.getByRole('button', { name: 'Budget' })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
	});

	test('runs the background while the tab is visible', async ({ page }) => {
		await page.addInitScript(() => {
			const raf = window.requestAnimationFrame.bind(window);
			const counter = window as unknown as { rafCount: number };
			counter.rafCount = 0;
			window.requestAnimationFrame = (callback) => {
				counter.rafCount += 1;
				return raf(callback);
			};
		});
		await page.goto('/');
		await page.waitForTimeout(800);
		const before = await page.evaluate(() => (window as unknown as { rafCount: number }).rafCount);
		await page.waitForTimeout(500);
		const after = await page.evaluate(() => (window as unknown as { rafCount: number }).rafCount);
		expect(after).toBeGreaterThan(before);
	});
});

test('the real table loads SQLite on demand and keeps its rows out of the app', async ({
	page
}) => {
	const wasm = wasmRequests(page);
	await page.goto('/');
	const stage = page.locator(STAGE);
	expect(wasm).toEqual([]);

	await page
		.getByRole('group', { name: 'Views' })
		.last()
		.getByRole('button', { name: 'Entry' })
		.click();
	await expect(stage.getByTestId('real-table')).toBeVisible();
	await expect.poll(() => wasm.length).toBeGreaterThan(0);

	await expect(stage.getByTestId('row-count')).toHaveText('6 rows');
	await stage.getByRole('button', { name: 'Add row' }).click();
	await expect(stage.getByTestId('row-count')).toHaveText('7 rows');

	await page
		.getByRole('group', { name: 'Views' })
		.last()
		.getByRole('button', { name: 'Chart' })
		.click();
	await expect(stage.getByText('Total amount')).toBeVisible();
	await expect(stage.getByText('by category')).toBeVisible();
	for (const category of ['Food', 'Fun', 'Home', 'Transport']) {
		await expect(stage.locator('svg text', { hasText: category })).toBeVisible();
	}

	await page.getByRole('main').getByRole('link', { name: 'Start now' }).first().click();
	await expect(page).toHaveURL(/\/app$/u);
	await expect(page.getByRole('button', { name: 'New table' }).first()).toBeVisible();
	await expect(page.getByText('Budget', { exact: true })).toBeHidden();
	const records = await page.evaluate(
		() =>
			new Promise<number>((resolve, reject) => {
				const open = indexedDB.open('torsel');
				open.onerror = () => reject(new Error('could not open the local database'));
				open.onsuccess = () => {
					const count = open.result.transaction('records').objectStore('records').count();
					count.onsuccess = () => resolve(count.result);
				};
			})
	);
	expect(records).toBe(0);
});

test('the year of cells sorts by table', async ({ page }) => {
	await page.goto('/');
	const tables = page.getByRole('group', { name: 'Tables' });
	await tables.scrollIntoViewIfNeeded();
	const trip = tables.getByRole('button', { name: 'Trip' });
	await trip.click();
	await expect(trip).toHaveAttribute('aria-pressed', 'true');
	await expect(tables.getByRole('button', { name: 'All' })).toHaveAttribute(
		'aria-pressed',
		'false'
	);
	await expect(page.getByTestId('year-band')).toBeVisible();
});
