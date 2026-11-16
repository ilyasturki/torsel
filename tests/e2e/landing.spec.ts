import type { Locator, Page } from '@playwright/test';

import { expect, test } from './harness.ts';

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

const posters = (page: Page): Locator => page.getByTestId('posters');

test('says what it is, shows the work done and loads no SQLite on the way', async ({ page }) => {
	const wasm = wasmRequests(page);
	await page.goto('/');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your numbers, taking shape.');
	await expect(page.getByRole('link', { name: 'Start now' }).first()).toBeInViewport();
	const demo = page.getByTestId('demo');
	await expect(demo.getByRole('gridcell', { name: 'Rent' })).toBeVisible();
	await demo.scrollIntoViewIfNeeded();
	await expect(demo.getByRole('gridcell', { name: '7680' })).toBeInViewport();
	await expect(
		demo.getByTestId('change').filter({ hasText: 'New view "By category" on Budget' })
	).toBeInViewport();
	await expect(prompt(page, 'Add Netflix 13 and climbing 45, both fun.')).toBeVisible();
	await posters(page).scrollIntoViewIfNeeded();
	await expect(posters(page).getByText('Average kg')).toBeVisible();
	await expect(posters(page).getByText('Total kg')).toBeVisible();
	await expect(posters(page).getByText('Perfect Days')).toBeVisible();
	await page.getByRole('heading', { name: 'Free and open source.' }).scrollIntoViewIfNeeded();
	await page.waitForTimeout(300);
	expect(wasm).toEqual([]);
});

test('three tables of other kinds show what a person ends up with', async ({ page }) => {
	await page.goto('/');
	const section = posters(page);
	await section.scrollIntoViewIfNeeded();
	await expect(
		section.getByRole('heading', { name: 'One table for each thing you keep track of.' })
	).toBeVisible();
	await expect(section.getByTestId('poster')).toHaveCount(3);
	const captions = section.getByRole('figure');
	await expect(captions.nth(0)).toContainText('Weigh-ins');
	await expect(captions.nth(0)).toContainText(/\d+ weigh-ins/u);
	await expect(captions.nth(1)).toContainText('180 sets');
	await expect(captions.nth(2)).toContainText('8 movies');
	await expect(section.getByText('7-day rolling average')).toBeVisible();
	for (const muscle of ['Back', 'Chest', 'Legs', 'Shoulders']) {
		await expect(section.getByText(muscle, { exact: true })).toBeVisible();
	}
});

test('nothing on the page scrolls sideways', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByTestId('demo').getByRole('gridcell', { name: 'Rent' })).toBeVisible();
	await posters(page).scrollIntoViewIfNeeded();
	await expect(posters(page).getByText('Average kg')).toBeVisible();
	const widths = await page.evaluate(() => [
		document.documentElement.scrollWidth,
		document.documentElement.clientWidth
	]);
	expect(widths[0]).toBe(widths[1]);
});

test('composes the demo for the width it gets', async ({ page, isMobile }) => {
	await page.goto('/');
	const demo = page.getByTestId('demo');
	await expect(demo.getByRole('gridcell', { name: 'Rent' })).toBeVisible();
	await demo.scrollIntoViewIfNeeded();
	await expect(demo.getByRole('columnheader', { name: /Per year/u })).toBeInViewport();
	const category = demo.getByRole('columnheader', { name: 'Category' });
	await expect(demo.getByRole('button', { name: 'Budget', exact: true })).toBeVisible();
	if (isMobile) {
		await expect(category).toBeHidden();
		const thread = await demo.getByTestId('thread').boundingBox();
		const grid = await demo.getByRole('grid').boundingBox();
		expect((thread?.y ?? 0) + (thread?.height ?? 0)).toBeLessThanOrEqual(grid?.y ?? 0);
	} else {
		await expect(category).toBeVisible();
	}
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
		await expect(
			page.getByText('your tables stay in your browser until you sync them')
		).toBeVisible();

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

test('the changes made ahead are real: they undo, and a prompt adds more', async ({
	page,
	isMobile
}) => {
	const wasm = wasmRequests(page);
	await page.goto('/');
	const demo = page.getByTestId('demo');
	await expect(demo.getByRole('gridcell', { name: 'Rent' })).toBeVisible();

	const card = demo.getByTestId('change').filter({ hasText: 'New field "Per year" in Budget' });
	await expect(card).toHaveAttribute('data-status', 'applied');
	await expect(demo.getByRole('gridcell', { name: '7680' })).toBeVisible();

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
	await expect(demo.getByRole('gridcell', { name: '156' })).toBeVisible();
	expect(wasm.length).toBeGreaterThan(0);

	await demo
		.getByRole('group', { name: 'Views' })
		.getByRole('button', { name: 'By category' })
		.click();
	await expect(
		demo.getByRole('group', { name: 'Views' }).getByRole('button', { name: 'By category' })
	).toHaveAttribute('aria-pressed', 'true');
	await expect(demo.getByText('Total amount')).toBeVisible();
	await expect(demo.getByText('1288')).toBeVisible();
	// A phone's width thins the axis to every other label.
	const shown = isMobile ? ['Food', 'Home'] : ['Food', 'Fun', 'Home', 'Transport'];
	for (const category of shown) {
		await expect(demo.locator('svg text', { hasText: category })).toBeVisible();
	}

	await demo.getByRole('button', { name: 'Start over' }).click();
	await expect(demo.getByTestId('change')).toHaveCount(0);
	await expect(demo.getByRole('columnheader', { name: /Per year/u })).toBeHidden();
	await expect(demo.getByTestId('row-count')).toHaveText('6 rows');
	await expect(prompt(page, 'Add what each one costs per year.')).toBeVisible();
});

test('the table name switches between the examples, each keeping its table and thread', async ({
	page
}) => {
	await page.goto('/');
	const demo = page.getByTestId('demo');
	await expect(demo.getByRole('gridcell', { name: 'Rent' })).toBeVisible();
	const open = async (from: string, to: string): Promise<void> => {
		await expect(async () => {
			await demo.getByRole('button', { name: from, exact: true }).click();
			await expect(page.getByRole('menu', { name: 'Examples' })).toBeVisible({ timeout: 500 });
		}).toPass();
		await page.getByRole('menuitem', { name: to }).click();
		await expect(demo.getByRole('button', { name: to, exact: true })).toBeVisible();
	};
	await open('Budget', 'Clients');
	await expect(demo.getByRole('gridcell', { name: 'Delta' })).toBeVisible();

	await prompt(page, 'Delta signed. Mark it won.').click();
	const card = demo.getByTestId('change').filter({ hasText: 'Change 1 row in Clients' });
	await expect(card).toContainText('Delta · Stage');
	await expect(card).toContainText('Talking');
	await expect(card).toContainText('Won');

	await open('Clients', 'Budget');
	await expect(demo.getByTestId('change')).toHaveCount(2);
	await open('Budget', 'Clients');
	await expect(card).toBeVisible();
});

test.describe('with reduced motion', () => {
	test.use({ contextOptions: { reducedMotion: 'reduce' } });

	test('the cells hold still, the chart stands grown and a prompt applies at once', async ({
		page
	}) => {
		await countFrames(page);
		await page.goto('/');
		const chart = page.locator('[data-testid="field"][data-shape="chart"]');
		await expect(chart).toBeAttached();
		await expect(page.getByTestId('demo').getByRole('gridcell', { name: 'Rent' })).toBeVisible();

		await page.waitForTimeout(600);
		const before = await frames(page);
		await page.waitForTimeout(800);
		expect(await frames(page)).toBe(before);

		// The last bar rises past the middle of the field; no bar reaches the copy.
		const box = await page.getByRole('heading', { level: 1 }).locator('..').boundingBox();
		const cells = await chart.evaluate(
			(canvas: HTMLCanvasElement, copy) => {
				const context = canvas.getContext('2d') as CanvasRenderingContext2D;
				const pitch = canvas.clientWidth / canvas.width;
				const alpha = (x: number, y: number): number => context.getImageData(x, y, 1, 1).data[3];
				const last = canvas.width - 2;
				let tallest = canvas.height;
				while (tallest > 0 && alpha(last, tallest - 1) > 120) tallest -= 1;
				// The cells whose centre falls inside the copy's box.
				let under = 0;
				const right = Math.min(canvas.width - 1, Math.floor(copy.right / pitch - 0.5));
				const bottom = Math.min(canvas.height - 1, Math.floor(copy.bottom / pitch - 0.5));
				for (let x = Math.ceil(copy.left / pitch - 0.5); x <= right; x++) {
					for (let y = Math.ceil(copy.top / pitch - 0.5); y <= bottom; y++) {
						under = Math.max(under, alpha(x, y));
					}
				}
				return { tallest: tallest / canvas.height, under };
			},
			{
				left: box?.x ?? 0,
				right: (box?.x ?? 0) + (box?.width ?? 0),
				top: box?.y ?? 0,
				bottom: (box?.y ?? 0) + (box?.height ?? 0)
			}
		);
		expect(cells.tallest).toBeLessThan(0.5);
		expect(cells.under).toBeLessThan(120);

		await prompt(page, 'Add Netflix 13 and climbing 45, both fun.').click();
		await expect(page.getByTestId('change')).toHaveCount(3);
		await expect(page.getByTestId('row-count')).toHaveText('8 rows');
	});
});

test.describe('with motion', () => {
	test.use({ contextOptions: { reducedMotion: 'no-preference' } });

	test('the prompt is typed and the assistant works before the change lands', async ({ page }) => {
		await page.goto('/');
		const demo = page.getByTestId('demo');
		await expect(demo.getByRole('gridcell', { name: 'Rent' })).toBeVisible();
		await prompt(page, 'Add Netflix 13 and climbing 45, both fun.').click();
		await expect(demo.getByRole('status')).toHaveText('Working…');
		await expect(demo.getByTestId('change')).toHaveCount(3);
		await expect(demo.getByRole('status')).toBeHidden();
	});

	test('runs the cells while the tab is visible', async ({ page }) => {
		await countFrames(page);
		await page.goto('/');
		await page.waitForTimeout(800);
		const before = await frames(page);
		await page.waitForTimeout(500);
		expect(await frames(page)).toBeGreaterThan(before);
	});

	test('the cells stop drawing once scrolled away', async ({ page }) => {
		await countFrames(page);
		await page.goto('/');
		await page.waitForTimeout(800);
		const demo = page.getByTestId('demo');
		await demo.evaluate((element) => element.scrollIntoView({ block: 'center' }));
		await expect(page.locator('[data-testid="field"][data-shape="chart"]')).not.toBeInViewport();
		await expect(page.locator('[data-testid="field"][data-shape="band"]')).not.toBeInViewport();
		await page.waitForTimeout(400);
		const before = await frames(page);
		await page.waitForTimeout(800);
		expect(await frames(page)).toBe(before);
	});

	test('the cells take colour under the pointer or a finger', async ({ page, isMobile }) => {
		await page.goto('/');
		const chart = page.locator('[data-testid="field"][data-shape="chart"]');
		await expect(chart).toBeAttached();
		// The first column's thirtieth cell, by its centre: below the header, above the first bar.
		const pitch = (): Promise<number> =>
			chart.evaluate((canvas: HTMLCanvasElement) => canvas.clientWidth / canvas.width);
		const alpha = (): Promise<number> =>
			chart.evaluate((canvas: HTMLCanvasElement) => {
				const context = canvas.getContext('2d') as CanvasRenderingContext2D;
				return context.getImageData(0, 29, 1, 1).data[3];
			});
		// Away from the bars a cell rests under 14% opacity (36 of 255); a redraw comes within two frames.
		await expect
			.poll(async () => {
				const size = await pitch();
				if (isMobile) await page.touchscreen.tap(size / 2, size * 29.5);
				else await page.mouse.move(size / 2, size * 29.5);
				await page.waitForTimeout(80);
				return alpha();
			})
			.toBeGreaterThan(190);
	});
});

test('a change card made ahead opens its view by touch or click', async ({ page, isMobile }) => {
	await page.goto('/');
	const demo = page.getByTestId('demo');
	const show = demo
		.getByTestId('change')
		.filter({ hasText: 'New view "By category" on Budget' })
		.getByRole('button', { name: /Show/u });
	if (isMobile) await show.tap();
	else await show.click();
	await expect(demo.getByText('Total amount')).toBeVisible();
	await expect(demo.getByText('1230')).toBeVisible();
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
