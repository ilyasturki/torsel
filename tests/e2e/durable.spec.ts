import type { APIRequestContext, Page } from '@playwright/test';

import { createBase, createTable, insertRows } from '../../src/lib/core/actions.ts';
import {
	askAddsDeadlift,
	askButton,
	askPanel,
	cell,
	editCell,
	expect,
	newAccount,
	passwordSignIn,
	redoButton,
	RETRY_RESET,
	script,
	seed,
	seedLifts,
	test,
	undoButton,
	watchErrors
} from './harness.ts';

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
		test.describe(() => {
			// With a worker, the next tab's navigation never completes after the spinning page closes.
			test.use({ serviceWorkers: name === 'a frozen page killed' ? 'block' : 'allow' });

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

/** What the server holds for the only action of the only thread. */
async function serverStatus(request: APIRequestContext): Promise<string> {
	const threads = (await (await request.get('/api/ai/threads', RETRY_RESET)).json()) as {
		id: string;
	}[];
	const oldest = threads.at(-1) as { id: string };
	const thread = (await (
		await request.get(`/api/ai/threads/${oldest.id}`, RETRY_RESET)
	).json()) as {
		actions: { status: string }[];
	};
	return thread.actions[0].status;
}

const threadLabel = (page: Page, label: string) =>
	page.getByTestId('thread').getByText(label, { exact: true });

async function reopenThread(page: Page): Promise<void> {
	await askButton(page).click();
	await expect(page.getByTestId('thread').getByText('Logged.')).toBeVisible();
}

async function closeThread(page: Page): Promise<void> {
	await askPanel(page).getByRole('button', { name: 'Close' }).click();
}

test('an undone action stays undone when its decision never reached the server', async ({
	page,
	context
}) => {
	await page.route('**/decisions', (route) => route.fulfill({ status: 400, json: {} }));
	await askAddsDeadlift(page, context.request);
	await closeThread(page);

	await undoButton(page).first().click();
	await expect(page.getByText('1 row', { exact: true })).toBeVisible();
	await page.unroute('**/decisions');
	await page.reload();

	await reopenThread(page);
	await expect(threadLabel(page, 'Undone')).toBeVisible();
	await expect(page.getByText('1 row', { exact: true })).toBeVisible();
	await closeThread(page);
	await expect(cell(page, 'Deadlift')).toHaveCount(0);
});

test('an undone action stays undone past a later edit, with its decision in flight at the reload', async ({
	page,
	context
}) => {
	let holding = true;
	await page.route('**/decisions', (route) => (holding ? undefined : route.continue()));
	await askAddsDeadlift(page, context.request);
	await closeThread(page);

	await undoButton(page).first().click();
	await expect(page.getByText('1 row', { exact: true })).toBeVisible();
	await editCell(page, 'Squat', 'Bench');
	holding = false;
	await page.reload();

	await reopenThread(page);
	await expect(threadLabel(page, 'Undone')).toBeVisible();
	await expect(page.getByText('1 row', { exact: true })).toBeVisible();
	await expect.poll(() => serverStatus(context.request)).toBe('undone');
});

test('a decision the server keeps refusing holds across a reload, and arrives once it can', async ({
	page,
	context
}) => {
	await page.route('**/decisions', (route) => route.fulfill({ status: 400, json: {} }));
	await askAddsDeadlift(page, context.request);
	await closeThread(page);

	await undoButton(page).first().click();
	await editCell(page, 'Squat', 'Bench');
	await page.reload();

	await reopenThread(page);
	await expect(threadLabel(page, 'Undone')).toBeVisible();
	await expect(page.getByText('1 row', { exact: true })).toBeVisible();
	expect(await serverStatus(context.request)).toBe('pending');

	await page.unroute('**/decisions');
	await page.evaluate(() => window.dispatchEvent(new Event('online')));
	await expect.poll(() => serverStatus(context.request)).toBe('undone');
});

test('a rejection that never reached the server stays rejected', async ({ page, context }) => {
	const key = await script(context.request, [
		{
			blocks: [
				{
					type: 'tool',
					id: 'toolu_field',
					name: 'add_field',
					input: { base: 'Gym', table: 'Lifts', name: 'Note', type: 'text' }
				}
			]
		},
		{ blocks: [{ type: 'text', text: 'Proposed.' }] }
	]);
	await page.route('**/decisions', (route) => route.fulfill({ status: 400, json: {} }));
	await askButton(page).click();
	await page.getByPlaceholder('Ask about your tables').fill(`${key} add a note column`);
	await page.getByRole('button', { name: 'Send' }).click();
	await expect(page.getByTestId('thread').getByText('Proposed.')).toBeVisible();

	await page.getByTestId('thread').getByRole('button', { name: 'Reject' }).click();
	await expect(threadLabel(page, 'Rejected')).toBeVisible();
	await page.reload();

	await askButton(page).click();
	await expect(threadLabel(page, 'Rejected')).toBeVisible();
});

test('an undo reaches the thread it belongs to after another one opened', async ({
	page,
	context
}) => {
	await askAddsDeadlift(page, context.request);
	await expect.poll(() => serverStatus(context.request)).toBe('applied');
	await askPanel(page).getByRole('button', { name: 'New' }).click();
	await closeThread(page);

	await undoButton(page).first().click();
	await expect(page.getByText('1 row', { exact: true })).toBeVisible();

	await expect.poll(() => serverStatus(context.request)).toBe('undone');
});

test('a decision one account still owes outlasts another signing in, and arrives when it is back', async ({
	page,
	context,
	account
}) => {
	await page.route('**/decisions', (route) => route.fulfill({ status: 400, json: {} }));
	await askAddsDeadlift(page, context.request);
	await closeThread(page);

	const synced = page.waitForResponse('**/api/sync');
	await undoButton(page).first().click();
	await synced;
	await page.goto('/app/settings');
	await page.getByRole('button', { name: 'Sign out' }).click();
	await expect(page.getByText('Signed out')).toBeVisible();
	await page.unroute('**/decisions');

	await page.goto('/app/login');
	await passwordSignIn(page, newAccount());
	await expect(page.getByRole('status')).toContainText('another account’s data');
	await page.waitForTimeout(500);
	await page.reload();
	await expect(page.getByRole('status')).toContainText('another account’s data');

	await page.goto('/app/settings');
	await page.getByRole('button', { name: 'Sign out' }).click();
	await expect(page.getByText('Signed out')).toBeVisible();
	await page.goto('/app/login');
	await passwordSignIn(page, account);
	await page.waitForURL((url) => !url.pathname.endsWith('/login'));
	await expect.poll(() => serverStatus(context.request)).toBe('undone');
});

const COULD_NOT_SAVE = 'Couldn’t save on this device';

const REFUSALS = {
	'a write throws': 'put',
	'its commit aborts': 'commit'
} as const;

/** Every write fails like a full disk until `fullDisk.on` turns false. */
function fillDisk(page: Page, how: 'put' | 'commit'): Promise<void> {
	return page.evaluate((refusal) => {
		const disk = { on: true };
		(window as unknown as { fullDisk: typeof disk }).fullDisk = disk;
		if (refusal === 'put') {
			const { put } = IDBObjectStore.prototype;
			IDBObjectStore.prototype.put = function (...args) {
				if (disk.on) {
					throw new DOMException('no room', 'QuotaExceededError');
				}
				return put.apply(this, args);
			};
		} else {
			const { commit } = IDBTransaction.prototype;
			IDBTransaction.prototype.commit = function () {
				if (disk.on && this.mode === 'readwrite') {
					this.abort();
				} else {
					commit.call(this);
				}
			};
		}
	}, how);
}

const emptyDisk = (page: Page): Promise<void> =>
	page.evaluate(() => {
		(window as unknown as { fullDisk: { on: boolean } }).fullDisk.on = false;
	});

for (const [refusal, how] of Object.entries(REFUSALS)) {
	test(`a change the disk refuses when ${refusal} says so, stays, and lands on retry`, async ({
		page
	}) => {
		await page.route('**/api/sync', (route) => route.fulfill({ status: 400, json: {} }));
		await fillDisk(page, how);
		const couldNotSave = page.getByRole('status').getByText(COULD_NOT_SAVE);

		await editCell(page, 'Squat', 'Bench');
		await expect(couldNotSave).toBeVisible();
		await expect(cell(page, 'Bench')).toBeVisible();

		await emptyDisk(page);
		await page.getByRole('status').getByRole('button', { name: 'retry' }).click();
		await expect(couldNotSave).toHaveCount(0);

		await page.reload();
		await expect(cell(page, 'Bench')).toBeVisible();
		await undoButton(page).first().click();
		await expect(cell(page, 'Squat')).toBeVisible();
	});
}

test('a refused change saves by itself once the disk has room', async ({ page }) => {
	await page.route('**/api/sync', (route) => route.fulfill({ status: 400, json: {} }));
	await fillDisk(page, 'put');
	const couldNotSave = page.getByRole('status').getByText(COULD_NOT_SAVE);
	await editCell(page, 'Squat', 'Bench');
	await expect(couldNotSave).toBeVisible();

	await emptyDisk(page);
	await expect(couldNotSave).toHaveCount(0);

	await page.reload();
	await expect(cell(page, 'Bench')).toBeVisible();
});

test('the next change carries a refused one with it', async ({ page }) => {
	await page.route('**/api/sync', (route) => route.fulfill({ status: 400, json: {} }));
	await fillDisk(page, 'commit');
	const couldNotSave = page.getByRole('status').getByText(COULD_NOT_SAVE);
	await editCell(page, 'Squat', 'Bench');
	await expect(couldNotSave).toBeVisible();

	await emptyDisk(page);
	await editCell(page, '100', '120');
	await expect(couldNotSave).toHaveCount(0);

	await page.reload();
	await expect(cell(page, 'Bench')).toBeVisible();
	await expect(cell(page, '120')).toBeVisible();
	await undoButton(page).first().click();
	await expect(cell(page, '100')).toBeVisible();
	await undoButton(page).first().click();
	await expect(cell(page, 'Squat')).toBeVisible();
});

test('a record whose save failed still lands, before the watermark passes it', async ({
	page,
	context
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
	await expect(status.getByText(COULD_NOT_SAVE)).toBeVisible();
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
