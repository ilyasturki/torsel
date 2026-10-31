import type { APIRequestContext, Locator, Page } from '@playwright/test';

import { createBase, createTable, insertRows } from '../../src/lib/core/actions.ts';
import {
	cell,
	expect,
	redoButton,
	RETRY_RESET,
	script,
	seed,
	test,
	undoButton,
	watchErrors
} from './harness.ts';

function seedLifts(request: APIRequestContext) {
	return seed(request, (ws, commit) => {
		const base = createBase(ws, 'Gym');
		commit(base.changes);
		const lifts = createTable(ws, base.id, 'Lifts', [
			{ name: 'Exercise', type: 'text' },
			{ name: 'Kg', type: 'number' }
		]);
		commit(lifts.changes);
		commit(
			insertRows(ws, lifts.id, [{ [lifts.fieldIds[0]]: 'Squat', [lifts.fieldIds[1]]: 100 }]).changes
		);
		return `/app/t/${lifts.id}`;
	});
}

const askButton = (page: Page): Locator => page.getByRole('button', { name: /^Ask/u });

const askPanel = (page: Page): Locator => page.locator('aside[aria-label="Ask"]');

/** The page stops dead right after the task that made the change: none of its callbacks ever run again. */
function freezeAfterChange(page: Page): Promise<void> {
	return page.evaluate(() => {
		const { put } = IDBObjectStore.prototype;
		IDBObjectStore.prototype.put = function (...args) {
			if ((args[0] as { dirty?: boolean }).dirty === true) {
				queueMicrotask(() => {
					console.info('frozen');
					for (;;);
				});
			}
			return put.apply(this, args);
		};
	});
}

type Kind = {
	name: string;
	serverHolds: string;
	prepare: (page: Page, request: APIRequestContext) => Promise<void>;
	change: (page: Page) => Promise<void>;
	reopened: (page: Page) => Promise<void>;
	undone: (page: Page) => Promise<void>;
};

const KINDS: Kind[] = [
	{
		name: 'a cell edit',
		serverHolds: 'Bench',
		async prepare(page) {
			await cell(page, 'Squat').dblclick();
			await page.getByRole('gridcell').getByRole('textbox').fill('Bench');
		},
		change: (page) => page.getByRole('gridcell').getByRole('textbox').press('Enter'),
		reopened: (page) => expect(cell(page, 'Bench')).toBeVisible(),
		undone: (page) => expect(cell(page, 'Squat')).toBeVisible()
	},
	{
		name: 'Add row',
		serverHolds: 'Deadlift',
		async prepare(page) {
			await page.getByRole('button', { name: 'Add row' }).click();
			await page.getByRole('dialog').getByLabel('Exercise').fill('Deadlift');
		},
		change: (page) => page.getByRole('dialog').getByRole('button', { name: 'Save' }).click(),
		reopened: (page) => expect(cell(page, 'Deadlift')).toBeVisible(),
		undone: (page) => expect(cell(page, 'Deadlift')).toHaveCount(0)
	},
	{
		name: 'an import',
		serverHolds: 'Deadlift',
		async prepare(page) {
			await page.getByRole('button', { name: 'More' }).click();
			await page
				.getByRole('dialog')
				.getByRole('button', { name: 'Import into this table' })
				.click();
			const sheet = page.getByRole('dialog', { name: 'Import' });
			await sheet.getByLabel('File to import').setInputFiles({
				name: 'more.csv',
				mimeType: 'text/csv',
				buffer: Buffer.from('Exercise,Kg\nDeadlift,140\nCurl,20\n')
			});
			await expect(sheet.getByText('2 columns, 2 rows')).toBeVisible();
		},
		change: (page) =>
			page.getByRole('dialog', { name: 'Import' }).getByRole('button', { name: 'Import' }).click(),
		async reopened(page) {
			await expect(page.getByText('3 rows')).toBeVisible();
			await expect(cell(page, 'Deadlift')).toBeVisible();
			await expect(cell(page, 'Curl')).toBeVisible();
		},
		undone: (page) => expect(page.getByText('1 row', { exact: true })).toBeVisible()
	},
	{
		name: 'an applied assistant action',
		serverHolds: 'Deadlift',
		async prepare(page, request) {
			const key = await script(request, [
				{
					blocks: [
						{
							type: 'tool',
							id: 'toolu_add',
							name: 'add_rows',
							input: { base: 'Gym', table: 'Lifts', rows: [{ Exercise: 'Deadlift', Kg: 140 }] }
						}
					]
				},
				{ blocks: [{ type: 'text', text: 'Logged.' }] }
			]);
			await askButton(page).click();
			await page.getByPlaceholder('Ask about your tables').fill(`${key} log a deadlift`);
		},
		async change(page) {
			await page.getByRole('button', { name: 'Send' }).click();
			await expect(page.getByText('2 rows')).toBeVisible();
		},
		async reopened(page) {
			await expect(page.getByText('2 rows')).toBeVisible();
			await askButton(page).click();
			await expect(page.getByTestId('thread').getByText('Applied', { exact: true })).toBeVisible();
			await askPanel(page).getByRole('button', { name: 'Close' }).click();
		},
		undone: (page) => expect(page.getByText('1 row', { exact: true })).toBeVisible()
	}
];

type Leave = (page: Page, change: () => Promise<void>) => Promise<Page>;

const LEAVES: Record<string, Leave> = {
	reload: async (page, change) => {
		await change();
		await page.reload();
		return page;
	},
	navigation: async (page, change) => {
		await change();
		await page.goto('/app/settings');
		return page;
	},
	'a closed tab': async (page, change) => {
		await change();
		const context = page.context();
		await page.close();
		return context.newPage();
	},
	'a frozen page killed': async (page, change) => {
		await freezeAfterChange(page);
		const frozen = page.waitForEvent('console', (message) => message.text() === 'frozen');
		const changing = change().catch(() => undefined);
		await frozen;
		const context = page.context();
		await page.close();
		await changing;
		return context.newPage();
	}
};

async function serverHolds(request: APIRequestContext, text: string): Promise<void> {
	await expect
		.poll(async () => {
			const response = await request.post('/api/sync', {
				...RETRY_RESET,
				data: { watermark: 0, push: [] }
			});
			return JSON.stringify(await response.json());
		})
		.toContain(text);
}

test.beforeEach(async ({ page, context, account }) => {
	void account;
	await page.goto(await seedLifts(context.request));
	await expect(cell(page, 'Squat')).toBeVisible();
});

for (const kind of KINDS) {
	for (const [name, leave] of Object.entries(LEAVES)) {
		test(`${kind.name} survives ${name}, with its undo step and queued for sync`, async ({
			page,
			context,
			pageErrors
		}) => {
			const path = new URL(page.url()).pathname;
			await kind.prepare(page, context.request);

			const next = await leave(page, () => kind.change(page));
			if (next !== page) {
				watchErrors(next, pageErrors);
			}

			await next.goto(path);
			await kind.reopened(next);
			await serverHolds(context.request, kind.serverHolds);
			await undoButton(next).first().click();
			await kind.undone(next);
		});
	}
}

test('an undo survives a reload, and its redo with it', async ({ page }) => {
	await cell(page, 'Squat').dblclick();
	await page.getByRole('gridcell').getByRole('textbox').fill('Bench');
	await page.getByRole('gridcell').getByRole('textbox').press('Enter');
	await expect(cell(page, 'Bench')).toBeVisible();

	await undoButton(page).first().click();
	await page.reload();
	await expect(cell(page, 'Squat')).toBeVisible();

	await redoButton(page).click();
	await page.reload();
	await expect(cell(page, 'Bench')).toBeVisible();
	await expect(undoButton(page).first()).toBeEnabled();
});

test('an undone action stays undone when its decision never reached the server', async ({
	page,
	context
}) => {
	const key = await script(context.request, [
		{
			blocks: [
				{
					type: 'tool',
					id: 'toolu_add',
					name: 'add_rows',
					input: { base: 'Gym', table: 'Lifts', rows: [{ Exercise: 'Deadlift', Kg: 140 }] }
				}
			]
		},
		{ blocks: [{ type: 'text', text: 'Logged.' }] }
	]);
	await page.route('**/decisions', (route) => route.fulfill({ status: 400, json: {} }));

	await askButton(page).click();
	await page.getByPlaceholder('Ask about your tables').fill(`${key} log a deadlift`);
	await page.getByRole('button', { name: 'Send' }).click();
	await expect(page.getByTestId('thread').getByText('Logged.')).toBeVisible();
	await askPanel(page).getByRole('button', { name: 'Close' }).click();
	await expect(page.getByText('2 rows')).toBeVisible();

	await undoButton(page).first().click();
	await expect(page.getByText('1 row', { exact: true })).toBeVisible();
	await page.unroute('**/decisions');
	await page.reload();

	await askButton(page).click();
	await expect(page.getByTestId('thread').getByText('Undone', { exact: true })).toBeVisible();
	await expect(page.getByText('1 row', { exact: true })).toBeVisible();
	await askPanel(page).getByRole('button', { name: 'Close' }).click();
	await expect(cell(page, 'Deadlift')).toHaveCount(0);
});

test('a record whose save failed still lands, before the watermark passes it', async ({
	page,
	context,
	pageErrors
}) => {
	await page.evaluate(() => {
		const { put } = IDBObjectStore.prototype;
		let failed = false;
		IDBObjectStore.prototype.put = function (...args) {
			if (!failed && JSON.stringify(args[0])?.includes('Deadlift')) {
				failed = true;
				throw new DOMException('no room', 'QuotaExceededError');
			}
			return put.apply(this, args);
		};
	});
	const path = await seed(context.request, (ws, commit) => {
		const base = createBase(ws, 'Other');
		commit(base.changes);
		const made = createTable(ws, base.id, 'More', [{ name: 'Exercise', type: 'text' }]);
		commit(made.changes);
		commit(insertRows(ws, made.id, [{ [made.fieldIds[0]]: 'Deadlift' }]).changes);
		return `/app/t/${made.id}`;
	});
	const status = page.getByRole('status');

	await page.evaluate(() => window.dispatchEvent(new Event('online')));
	await expect(status.getByText('Sync failed')).toBeVisible();
	expect(pageErrors.splice(0)).toEqual(['no room']);
	await status.getByRole('button', { name: 'retry' }).click();
	await expect(status).toHaveCount(0);

	await page.route('**/api/sync', (route) => route.fulfill({ status: 400, json: {} }));
	await page.goto(path);
	await expect(cell(page, 'Deadlift')).toBeVisible();
});

test('10,000 pasted rows land in one transaction, straight before a reload', async ({
	page,
	context
}) => {
	test.skip(test.info().project.name === 'phone', 'a phone has no keyboard shortcut to paste');
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);

	const rows = Array.from({ length: 10_000 }, (_, index) => `Row ${index}\t${index}`).join('\n');
	await page.evaluate((text) => navigator.clipboard.writeText(text), rows);
	await page.evaluate(() => {
		const seen = new Set<IDBTransaction>();
		const { put } = IDBObjectStore.prototype;
		IDBObjectStore.prototype.put = function (...args) {
			if ((args[0] as { dirty?: boolean }).dirty === true) {
				seen.add(this.transaction);
				(window as unknown as { writers: number }).writers = seen.size;
			}
			return put.apply(this, args);
		};
	});

	await cell(page, 'Squat').click();
	await page.keyboard.press('Control+V');
	await expect(page.getByText('10000 rows', { exact: true })).toBeVisible();
	expect(await page.evaluate(() => (window as unknown as { writers: number }).writers)).toBe(1);

	await page.reload();
	await expect(page.getByText('10000 rows', { exact: true })).toBeVisible();
	await undoButton(page).first().click();
	await expect(page.getByText('1 row', { exact: true })).toBeVisible();
});
