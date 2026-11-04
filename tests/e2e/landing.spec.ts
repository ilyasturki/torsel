import type { Locator, Page } from '@playwright/test';

import { expect, test } from './harness.ts';

// A prerendered button ignores clicks until the page hydrates.
async function press(button: Locator): Promise<void> {
	await expect(async () => {
		await button.click();
		await expect(button).toHaveAttribute('aria-pressed', 'true', { timeout: 500 });
	}).toPass();
}

function wasmRequests(page: Page): string[] {
	const seen: string[] = [];
	page.on('request', (request) => {
		if (request.url().endsWith('.wasm')) seen.push(request.url());
	});
	return seen;
}

async function countFrames(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const raf = window.requestAnimationFrame.bind(window);
		const counter = window as unknown as { rafCount: number };
		counter.rafCount = 0;
		window.requestAnimationFrame = (callback) => {
			counter.rafCount += 1;
			return raf(callback);
		};
	});
}

const frames = (page: Page): Promise<number> =>
	page.evaluate(() => (window as unknown as { rafCount: number }).rafCount);

const prompt = (page: Page, text: string): Locator =>
	page.getByRole('group', { name: 'Prompts' }).getByRole('button', { name: text });

test('says what it is and loads no SQLite on the way', async ({ page }) => {
	const wasm = wasmRequests(page);
	await page.goto('/');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(
		'The spreadsheet that does the work.'
	);
	await expect(page.getByRole('link', { name: 'Start now' }).first()).toBeVisible();
	const demo = page.getByTestId('demo');
	await expect(demo.getByRole('gridcell', { name: 'Rent' })).toBeVisible();
	await page.getByRole('heading', { name: 'Try it on your own data.' }).scrollIntoViewIfNeeded();
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

test.describe('with its worker', () => {
	test.use({ serviceWorkers: 'allow' });

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
		await expect(page.getByRole('listitem').filter({ hasText: 'Added offline' })).toBeVisible();
	});
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

test('a prompt changes the real table, shows its diff and undoes', async ({ page }) => {
	const wasm = wasmRequests(page);
	await page.goto('/');
	const demo = page.getByTestId('demo');
	await expect(demo.getByRole('gridcell', { name: 'Rent' })).toBeVisible();

	await prompt(page, 'Add what each one costs per year.').click();
	const card = demo.getByTestId('change').filter({ hasText: 'New field "Per year" in Budget' });
	await expect(card).toHaveAttribute('data-status', 'applied');
	await expect(demo.getByRole('columnheader', { name: /Per year/u })).toBeVisible();
	await expect(demo.getByRole('gridcell', { name: '7680' })).toBeVisible();
	expect(wasm.length).toBeGreaterThan(0);

	await card.getByRole('button', { name: 'Undo New field "Per year" in Budget' }).click();
	await expect(card).toHaveAttribute('data-status', 'undone');
	await expect(demo.getByRole('columnheader', { name: /Per year/u })).toBeHidden();
	await card.getByRole('button', { name: 'Redo New field "Per year" in Budget' }).click();
	await expect(demo.getByRole('columnheader', { name: /Per year/u })).toBeVisible();

	await prompt(page, 'Add Netflix 13 and climbing 45, both fun.').click();
	await expect(
		demo.getByTestId('change').filter({ hasText: 'Add 2 rows to Budget' })
	).toBeVisible();
	await expect(demo.getByTestId('row-count')).toHaveText('8 rows');

	await prompt(page, 'Show me where the money goes.').click();
	await expect(
		demo.getByRole('group', { name: 'Views' }).getByRole('button', { name: 'By category' })
	).toHaveAttribute('aria-pressed', 'true');
	await expect(demo.getByText('Total amount')).toBeVisible();
	await expect(demo.getByText('1288')).toBeVisible();
	for (const category of ['Food', 'Fun', 'Home', 'Transport']) {
		await expect(demo.locator('svg text', { hasText: category })).toBeVisible();
	}

	await demo.getByRole('button', { name: 'Start over' }).click();
	await expect(demo.getByTestId('change')).toHaveCount(0);
	await expect(demo.getByTestId('row-count')).toHaveText('6 rows');
	await expect(prompt(page, 'Add what each one costs per year.')).toBeVisible();
});

test('each example keeps its own table and thread', async ({ page }) => {
	await page.goto('/');
	const demo = page.getByTestId('demo');
	const examples = demo.getByRole('group', { name: 'Examples' });
	await press(examples.getByRole('button', { name: 'Clients' }));
	await expect(examples.getByRole('button', { name: 'Budget' })).toHaveAttribute(
		'aria-pressed',
		'false'
	);
	await expect(demo.getByRole('gridcell', { name: 'Delta' })).toBeVisible();

	await prompt(page, 'Delta signed. Mark it won.').click();
	const card = demo.getByTestId('change').filter({ hasText: 'Change 1 row in Clients' });
	await expect(card).toContainText('Delta · Stage');
	await expect(card).toContainText('Talking');
	await expect(card).toContainText('Won');

	await press(examples.getByRole('button', { name: 'Budget' }));
	await expect(demo.getByTestId('change')).toHaveCount(0);
	await press(examples.getByRole('button', { name: 'Clients' }));
	await expect(card).toBeVisible();
});

test.describe('with reduced motion', () => {
	test.use({ contextOptions: { reducedMotion: 'reduce' } });

	test('the background holds still and a prompt applies at once', async ({ page }) => {
		await countFrames(page);
		await page.goto('/');
		await expect(page.getByTestId('backdrop')).toBeAttached();
		await expect(page.getByTestId('demo').getByRole('gridcell', { name: 'Rent' })).toBeVisible();

		await page.waitForTimeout(600);
		const before = await frames(page);
		await page.waitForTimeout(800);
		expect(await frames(page)).toBe(before);

		await prompt(page, 'Add what each one costs per year.').click();
		await expect(page.getByTestId('change')).toHaveCount(1);
		await expect(page.getByRole('columnheader', { name: /Per year/u })).toBeVisible();
	});
});

test.describe('with motion', () => {
	test.use({ contextOptions: { reducedMotion: 'no-preference' } });

	test('the prompt is typed and the assistant works before the change lands', async ({ page }) => {
		await page.goto('/');
		const demo = page.getByTestId('demo');
		await expect(demo.getByRole('gridcell', { name: 'Rent' })).toBeVisible();
		await prompt(page, 'Add what each one costs per year.').click();
		await expect(demo.getByRole('status')).toHaveText('Working…');
		await expect(demo.getByTestId('change')).toHaveCount(1);
		await expect(demo.getByRole('status')).toBeHidden();
	});

	test('runs the background while the tab is visible', async ({ page }) => {
		await countFrames(page);
		await page.goto('/');
		await page.waitForTimeout(800);
		const before = await frames(page);
		await page.waitForTimeout(500);
		expect(await frames(page)).toBeGreaterThan(before);
	});

	test('the background takes colour under the pointer or a finger', async ({ page, isMobile }) => {
		await page.goto('/');
		const backdrop = page.getByTestId('backdrop');
		await expect(backdrop).toBeAttached();
		// The first column's twelfth cell, by its centre, where the brush paints at full strength.
		const pitch = (): Promise<number> =>
			backdrop.evaluate((canvas: HTMLCanvasElement) => canvas.clientWidth / canvas.width);
		const alpha = (): Promise<number> =>
			backdrop.evaluate((canvas: HTMLCanvasElement) => {
				const context = canvas.getContext('2d') as CanvasRenderingContext2D;
				return context.getImageData(0, 11, 1, 1).data[3];
			});
		// At rest a cell stays under 40% opacity (102 of 255); a redraw comes within two frames.
		await expect
			.poll(async () => {
				const size = await pitch();
				if (isMobile) await page.touchscreen.tap(size / 2, size * 11.5);
				else await page.mouse.move(size / 2, size * 11.5);
				await page.waitForTimeout(80);
				return alpha();
			})
			.toBeGreaterThan(150);
	});
});

test('the sample stays in the page and out of the app', async ({ page }) => {
	await page.goto('/');
	const demo = page.getByTestId('demo');
	await demo.getByRole('group', { name: 'Views' }).getByRole('button', { name: 'Entry' }).click();
	await demo.getByRole('button', { name: 'Add row' }).click();
	await expect(demo.getByTestId('row-count')).toHaveText('7 rows');

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
