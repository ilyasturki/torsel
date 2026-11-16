import names from '../../src/lib/i18n/names.ts';
import type { APIRequestContext, Locator, Page } from '@playwright/test';

import { createBase, createTable, defaultViews, insertRows } from '../../src/lib/core/actions.ts';
import { expect, openTable, script, seed, tablePath, test } from './harness.ts';

const FAKE = process.env.TORSEL_TEST_FAKE ?? '';

type Seen = {
	requests: { messages: { role: string; content: unknown }[]; body: Record<string, unknown> }[];
	aborted: number;
	titles: Record<string, unknown>[];
};

async function seen(request: APIRequestContext, key: string): Promise<Seen> {
	return (await request.get(`${FAKE}/__seen?key=${key}`)).json();
}

/** What the model was told last: the person's message with its note, as JSON. */
async function lastTold(request: APIRequestContext, key: string): Promise<string> {
	const { requests } = await seen(request, key);
	return JSON.stringify(requests.at(-1)?.messages.at(-1));
}

function seedLifts(request: APIRequestContext) {
	return seed(request, (ws, commit) => {
		const base = createBase(ws, 'Tables');
		commit(base.changes);
		const table = createTable(
			ws,
			base.id,
			'Lifts',
			[
				{ name: 'Exercise', type: 'text' },
				{ name: 'Reps', type: 'number' },
				{ name: 'Kg', type: 'number' }
			],
			() => defaultViews(names.en)
		);
		commit(table.changes);
		const [exercise, reps, kg] = table.fieldIds;
		const rows = insertRows(ws, table.id, [
			{ [exercise]: 'Bench', [reps]: 8, [kg]: 80 },
			{ [exercise]: 'Squat', [reps]: 5, [kg]: 100 }
		]);
		commit(rows.changes);
		return { base: base.id, table: table.id, rows: rows.ids, fields: table.fieldIds };
	});
}

const panel = (page: Page): Locator => page.locator('aside[aria-label="Ask"]');

const thread = (page: Page): Locator => page.getByTestId('thread');

const composer = (page: Page): Locator => page.getByPlaceholder('Ask about your tables');

const cards = (page: Page): Locator => thread(page).getByTestId('change');

const isPhone = (): boolean => test.info().project.name === 'phone';

async function openAsk(page: Page): Promise<void> {
	if (!(await composer(page).isVisible())) {
		await page.getByRole('button', { name: /^Ask/u }).click();
	}
}

async function ask(page: Page, text: string): Promise<void> {
	await openAsk(page);
	await composer(page).fill(text);
	await panel(page).getByRole('button', { name: 'Send' }).click();
}

/** On a phone the panel covers the table: what a spec reads in the grid needs it closed. */
async function seeTable(page: Page): Promise<void> {
	if (isPhone() && (await composer(page).isVisible())) {
		await panel(page).getByRole('button', { name: 'Close' }).click();
	}
}

test('every change applies at once, shows its before and after, and undoes alone or with its turn', async ({
	page,
	context,
	account
}) => {
	void account;
	const { table, rows, fields } = await seedLifts(context.request);
	const key = await script(context.request, [
		{
			blocks: [
				{
					type: 'tool',
					id: 'toolu_add',
					name: 'add_rows',
					input: {
						base: 'Tables',
						table: 'Lifts',
						rows: [{ Exercise: 'Deadlift', Reps: 3, Kg: 140 }]
					}
				},
				{
					type: 'tool',
					id: 'toolu_edit',
					name: 'update_rows',
					input: { base: 'Tables', table: 'Lifts', updates: [{ id: rows[1], values: { Kg: 110 } }] }
				},
				{
					type: 'tool',
					id: 'toolu_drop',
					name: 'delete',
					input: { base: 'Tables', id: fields[1] }
				}
			]
		},
		{ blocks: [{ type: 'text', text: 'Done.' }] },
		{ blocks: [{ type: 'text', text: 'Noted.' }] }
	]);
	await page.goto(tablePath(table));
	await ask(page, `${key} log a deadlift, squat was 110, and drop reps`);

	await expect(thread(page).getByText('Done.')).toBeVisible();
	await expect(cards(page)).toHaveCount(3);
	const [added, edited, dropped] = [cards(page).nth(0), cards(page).nth(1), cards(page).nth(2)];
	await expect(added).toContainText('Add 1 row to Lifts');
	await expect(added).toContainText('Deadlift');
	await expect(edited).toContainText('Squat · Kg');
	await expect(edited.locator('.line-through')).toHaveText('100');
	await expect(edited).toContainText('110');
	await expect(dropped).toContainText('Delete field "Reps"');
	await expect(dropped).toContainText('8');
	await expect(thread(page).getByText('Applied')).toHaveCount(0);

	await seeTable(page);
	await expect(page.getByText('3 rows')).toBeVisible();
	await expect(page.getByRole('gridcell', { name: '110', exact: true })).toBeVisible();
	await expect(page.getByRole('grid').getByRole('columnheader', { name: 'Reps' })).toHaveCount(0);

	await openAsk(page);
	await edited.getByRole('button', { name: 'Undo' }).click();
	await expect(edited).toHaveAttribute('data-status', 'undone');
	await expect(edited.getByRole('button', { name: 'Redo' })).toBeVisible();
	await seeTable(page);
	await expect(page.getByRole('gridcell', { name: '100', exact: true })).toBeVisible();

	await openAsk(page);
	await thread(page).getByRole('button', { name: 'Undo all' }).click();
	await expect(cards(page).locator('[data-status="undone"]')).toHaveCount(0);
	await expect(thread(page).locator('[data-status="undone"]')).toHaveCount(3);
	await seeTable(page);
	await expect(page.getByText('2 rows')).toBeVisible();
	await expect(page.getByRole('grid').getByRole('columnheader', { name: 'Reps' })).toBeVisible();

	await openAsk(page);
	await thread(page).getByRole('button', { name: 'Redo all' }).click();
	await expect(thread(page).locator('[data-status="applied"]')).toHaveCount(3);
	await added.getByRole('button', { name: 'Undo' }).click();

	await ask(page, `${key} what changed`);
	await expect(thread(page).getByText('Noted.')).toBeVisible();
	const told = await lastTold(context.request, key);
	expect(told).toContain('Undone by the person since your last reply');
	expect(told).toContain('- Add 1 row to Lifts.');
	expect(told).not.toContain('Change 1 row');
});

test('the request says what is on screen, and the assistant can open what it made', async ({
	page,
	context,
	account
}) => {
	test.skip(isPhone(), 'selecting a range takes a keyboard');
	void account;
	const { table, rows } = await seedLifts(context.request);
	const key = await script(context.request, [
		{
			blocks: [
				{
					type: 'tool',
					id: 'toolu_table',
					name: 'create_table',
					input: { name: 'Movies', fields: [{ name: 'Title', type: 'text' }] }
				}
			]
		},
		{ blocks: [{ type: 'tool', id: 'toolu_open', name: 'open', input: { table: 'Movies' } }] },
		{ blocks: [{ type: 'text', text: 'Ready.' }] },
		{ blocks: [{ type: 'text', text: 'Settings it is.' }] }
	]);
	await page.goto(tablePath(table));
	await page.getByRole('gridcell', { name: 'Bench' }).click();
	await page.getByRole('gridcell', { name: '5', exact: true }).click({ modifiers: ['Shift'] });
	await openAsk(page);
	await expect(page.getByTestId('context')).toHaveText('On Lifts, Grid, 2 rows selected');

	await ask(page, `${key} a table for movies`);
	await expect(thread(page).getByText('Ready.')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Movies' })).toBeVisible();

	const { requests } = await seen(context.request, key);
	const note = JSON.stringify(requests[0].messages.at(-1));
	expect(note).toContain(`Screen: table \\"Lifts\\" (${table})`);
	expect(note).toContain('Exercise (');
	expect(note).toContain('Selected: 2 rows, in Exercise, Reps.');
	expect(note).toContain(`- ${rows[0]}: {\\"Exercise\\":\\"Bench\\",\\"Reps\\":8}`);
	expect(note).toMatch(/Today: \d{4}-\d{2}-\d{2}\./u);
	expect(requests[0].body.system).not.toContain(table);

	await page.goto('/app/settings');
	await ask(page, `${key} anything here`);
	await expect(thread(page).getByText('Settings it is.')).toBeVisible();
	expect(await lastTold(context.request, key)).toContain('Screen: the settings page');
});

test('past conversations list by title and date, rename, delete, and reopen where they were', async ({
	page,
	context,
	account
}) => {
	void account;
	const { table } = await seedLifts(context.request);
	const key = await script(context.request, [
		{ blocks: [{ type: 'text', text: 'First answer.' }] },
		{ blocks: [{ type: 'text', text: 'Second answer.' }] }
	]);
	await page.goto(tablePath(table));
	await ask(page, `${key} first question`);
	await expect(thread(page).getByText('First answer.')).toBeVisible();

	await panel(page).getByRole('button', { name: 'New', exact: true }).click();
	await expect(thread(page).getByText('First answer.')).toHaveCount(0);
	await ask(page, `${key} second question`);
	await expect(thread(page).getByText('Second answer.')).toBeVisible();

	await panel(page).getByRole('button', { name: 'History' }).click();
	const list = panel(page).getByRole('list', { name: 'Threads' });
	await expect(list.getByRole('listitem')).toHaveCount(2);
	await expect(list.getByRole('listitem').first()).toContainText('second question');

	await list.getByRole('button', { name: /^Rename .*first question/u }).click();
	await panel(page).getByLabel('Thread name').fill('Squat plan');
	await panel(page).getByLabel('Thread name').press('Enter');
	await expect(list.getByText('Squat plan')).toBeVisible();

	await list.getByRole('button', { name: /^Delete .*second question/u }).click();
	await expect(list.getByRole('listitem')).toHaveCount(1);
	await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
	await expect(list.getByRole('listitem')).toHaveCount(2);
	await list.getByRole('button', { name: /^Delete .*second question/u }).click();
	await expect(list.getByRole('listitem')).toHaveCount(1);

	await page.reload();
	await expect
		.poll(async () => (await (await context.request.get('/api/ai/threads')).json()).length)
		.toBe(1);
	await openAsk(page);
	await panel(page).getByRole('button', { name: 'History' }).click();
	await list.getByRole('button', { name: /^Squat plan/u }).click();
	await expect(thread(page).getByText('First answer.')).toBeVisible();
	await expect(panel(page).getByText('Squat plan')).toBeVisible();
});

test('a new conversation gets a short title beside its first reply, never holding it', async ({
	page,
	context,
	account
}) => {
	void account;
	const { table } = await seedLifts(context.request);
	const key = await script(
		context.request,
		[{ blocks: [{ type: 'text', text: 'Done.' }] }, { blocks: [{ type: 'text', text: 'Again.' }] }],
		{ title: 'Bench press sets', hold: true }
	);
	await page.goto(tablePath(table));
	await ask(page, `${key} log 3x10 at 72 on bench press`);

	await expect(thread(page).getByText('Done.')).toBeVisible();
	await expect(panel(page).getByRole('button', { name: 'Send' })).toBeVisible();
	const header = panel(page).getByTestId('thread-title');
	await expect(header).not.toHaveText('Bench press sets');

	await context.request.post(`${FAKE}/__release-title?key=${key}`);
	await expect(header).toHaveText('Bench press sets');
	const { titles, requests } = await seen(context.request, key);
	expect(requests).toHaveLength(1);
	expect(titles).toHaveLength(1);
	expect(titles[0].model).toBe('claude-haiku-5-5');
	expect(JSON.stringify(titles[0].messages)).toContain('<screen>On Lifts');

	await ask(page, `${key} again`);
	await expect(thread(page).getByText('Again.')).toBeVisible();
	expect((await seen(context.request, key)).titles).toHaveLength(1);
	await panel(page).getByRole('button', { name: 'History' }).click();
	await expect(
		panel(page).getByRole('list', { name: 'Threads' }).getByText('Bench press sets')
	).toBeVisible();
});

test('a conversation the person renamed keeps their name when the title lands after', async ({
	page,
	context,
	account
}) => {
	void account;
	const { table } = await seedLifts(context.request);
	const key = await script(context.request, [{ blocks: [{ type: 'text', text: 'Done.' }] }], {
		title: 'Generated name',
		hold: true
	});
	await page.goto(tablePath(table));
	await ask(page, `${key} plan my squats`);
	await expect(thread(page).getByText('Done.')).toBeVisible();

	await panel(page).getByRole('button', { name: 'History' }).click();
	const list = panel(page).getByRole('list', { name: 'Threads' });
	await list.getByRole('button', { name: /^Rename/u }).click();
	await panel(page).getByLabel('Thread name').fill('Squat plan');
	await panel(page).getByLabel('Thread name').press('Enter');
	await expect(list.getByText('Squat plan')).toBeVisible();

	await context.request.post(`${FAKE}/__release-title?key=${key}`);
	await expect.poll(async () => (await seen(context.request, key)).titles.length).toBe(1);
	await expect
		.poll(async () => (await (await context.request.get('/api/ai/threads')).json())[0].title)
		.toBe('Squat plan');
	await expect(panel(page).getByTestId('thread-title')).toHaveText('Squat plan');
});

test('a title call that fails leaves the first message, cut to fit', async ({
	page,
	context,
	account
}) => {
	void account;
	const { table } = await seedLifts(context.request);
	const key = await script(context.request, [{ blocks: [{ type: 'text', text: 'Done.' }] }], {
		fail: true
	});
	await page.goto(tablePath(table));
	await ask(page, `${key} every morning pull my weight`);
	await expect(thread(page).getByText('Done.')).toBeVisible();
	const [listed] = await (await context.request.get('/api/ai/threads')).json();
	expect(listed.title.length).toBeLessThanOrEqual(32);
	expect(listed.title).not.toContain('…');
});

test('a reply that failed or was stopped runs again from where it was', async ({
	page,
	context,
	account
}) => {
	void account;
	const { table } = await seedLifts(context.request);
	const key = await script(context.request, [
		{ blocks: [{ type: 'text', text: 'Starting to answer' }], failAfter: 'Starting to answer' },
		{ blocks: [{ type: 'text', text: 'Back again.' }] },
		{
			blocks: [{ type: 'text', text: 'Counting every set you ever did' }],
			holdAfter: 'Counting every set you ever did'
		},
		{ blocks: [{ type: 'text', text: 'Shorter now.' }] }
	]);
	await page.goto(tablePath(table));
	await ask(page, `${key} go`);

	await expect(thread(page).getByRole('alert')).toHaveText(
		'The assistant stopped responding. Try again.'
	);
	await thread(page).getByRole('button', { name: 'Retry' }).click();
	await expect(thread(page).getByText('Back again.')).toBeVisible();
	await expect(thread(page).getByRole('alert')).toHaveCount(0);

	let { requests } = await seen(context.request, key);
	expect(requests[1].messages).toEqual(requests[0].messages);

	await ask(page, `${key} count`);
	await expect.poll(async () => (await seen(context.request, key)).requests.length).toBe(3);
	await panel(page).getByRole('button', { name: 'Stop' }).click();
	await expect(thread(page).getByText('Stopped.')).toBeVisible();
	await thread(page).getByRole('button', { name: 'Retry' }).click();
	await expect(thread(page).getByText('Shorter now.')).toBeVisible();
	await expect(thread(page).getByText('Counting every set', { exact: false })).toHaveCount(0);

	({ requests } = await seen(context.request, key));
	expect(requests[3].messages).toEqual(requests[2].messages);
	expect(JSON.stringify(requests[3].messages)).not.toContain('Counting every set');
});

test('editing the last message takes back what its turn did and asks again', async ({
	page,
	context,
	account
}) => {
	void account;
	const { table } = await seedLifts(context.request);
	const key = await script(context.request, [
		{
			blocks: [
				{
					type: 'tool',
					id: 'toolu_dead',
					name: 'add_rows',
					input: { base: 'Tables', table: 'Lifts', rows: [{ Exercise: 'Deadlift', Kg: 140 }] }
				}
			]
		},
		{ blocks: [{ type: 'text', text: 'Logged the deadlift.' }] },
		{
			blocks: [
				{
					type: 'tool',
					id: 'toolu_row',
					name: 'add_rows',
					input: { base: 'Tables', table: 'Lifts', rows: [{ Exercise: 'Row', Kg: 60 }] }
				}
			]
		},
		{ blocks: [{ type: 'text', text: 'Logged the row.' }] }
	]);
	await page.goto(tablePath(table));
	await ask(page, `${key} log a deadlift`);
	await expect(thread(page).getByText('Logged the deadlift.')).toBeVisible();

	await thread(page).getByRole('button', { name: 'Edit' }).click();
	await expect(composer(page)).toHaveValue(`${key} log a deadlift`);
	await expect(composer(page)).toBeFocused();
	await composer(page).fill(`${key} log a row instead`);
	await panel(page).getByRole('button', { name: 'Save' }).click();
	await expect(thread(page).getByText('Logged the row.')).toBeVisible();
	await expect(thread(page).getByText('log a deadlift')).toHaveCount(0);
	await expect(thread(page).getByText('Logged the deadlift.')).toHaveCount(0);

	await seeTable(page);
	await expect(page.getByRole('gridcell', { name: 'Row', exact: true })).toBeVisible();
	await expect(page.getByRole('gridcell', { name: 'Deadlift', exact: true })).toHaveCount(0);
	await expect(page.getByText('3 rows')).toBeVisible();

	const { requests } = await seen(context.request, key);
	const asked = JSON.stringify(requests[2].messages);
	expect(asked).toContain('log a row instead');
	expect(asked).not.toContain('log a deadlift');
	expect(asked).not.toContain('Add 1 row');
});

test('files attach to a message, reach the model, import whole, and stay with the thread', async ({
	page,
	context,
	account
}) => {
	void account;
	const { table } = await seedLifts(context.request);
	const lines = [
		'date,kg',
		...Array.from({ length: 30_000 }, (_, at) => `2026-01-${(at % 28) + 1},${70 + (at % 20)}`)
	];
	const csv = Buffer.from(`${lines.join('\n')}\n`);
	const key = await script(context.request, [
		{
			blocks: [
				{ type: 'tool', id: 'toolu_import', name: 'import_file', input: { file: 'weigh-ins.csv' } }
			]
		},
		{ blocks: [{ type: 'text', text: 'Imported.' }] }
	]);
	await page.goto(tablePath(table));
	await openAsk(page);
	await panel(page)
		.locator('input[type=file]')
		.setInputFiles([
			{ name: 'weigh-ins.csv', mimeType: 'text/csv', buffer: csv },
			{
				name: 'scale.png',
				mimeType: 'image/png',
				buffer: Buffer.from(
					'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
					'base64'
				)
			}
		]);
	const attached = panel(page).getByRole('list', { name: 'Attached files' });
	await expect(attached.getByRole('listitem')).toHaveCount(2);
	await expect(attached).toContainText('weigh-ins.csv');
	await expect(panel(page).getByRole('button', { name: 'Send' })).toBeDisabled();
	await composer(page).fill(`${key} import my weigh-ins`);
	await expect(panel(page).getByRole('button', { name: 'Send' })).toBeEnabled();
	await panel(page).getByRole('button', { name: 'Send' }).click();

	await expect(thread(page).getByText('Imported.')).toBeVisible();
	await expect(cards(page).first()).toContainText('New table "weigh-ins" from weigh-ins.csv');
	await expect(thread(page).getByText('weigh-ins.csv', { exact: true })).toBeVisible();

	const { requests } = await seen(context.request, key);
	const told = JSON.stringify(requests[0].messages.at(-1));
	expect(told).toContain('30000 rows; the first 100 shown');
	expect(told).toContain('"type":"image"');
	expect(told).toContain('date,kg\\n2026-01-1,70');

	await seeTable(page);
	await openTable(page, 'weigh-ins');
	await expect(page.getByText('30000 rows')).toBeVisible();

	await page.reload();
	await openAsk(page);
	await expect(thread(page).getByText('scale.png', { exact: true })).toBeVisible();
});

test('the composer grows with its lines; Enter sends and Shift+Enter breaks a line', async ({
	page,
	context,
	account
}) => {
	void account;
	const { table } = await seedLifts(context.request);
	const key = await script(context.request, [{ blocks: [{ type: 'text', text: 'Two lines.' }] }]);
	await page.goto(tablePath(table));
	await openAsk(page);
	const field = composer(page);
	const one = (await field.boundingBox())?.height ?? 0;

	await field.fill(key);
	await field.press('Shift+Enter');
	await field.pressSequentially('second line');
	await field.press('Shift+Enter');
	await field.pressSequentially('third line');
	await expect(field).toHaveValue(`${key}\nsecond line\nthird line`);
	expect((await field.boundingBox())?.height ?? 0).toBeGreaterThan(one * 1.8);

	// A file dropped on the panel or pasted into the field attaches to the message, never the import sheet.
	await panel(page).evaluate((node) => {
		const files = new DataTransfer();
		files.items.add(new File(['kg\n80\n'], 'dropped.csv', { type: 'text/csv' }));
		node.dispatchEvent(
			new DragEvent('dragover', { dataTransfer: files, bubbles: true, cancelable: true })
		);
		node.dispatchEvent(
			new DragEvent('drop', { dataTransfer: files, bubbles: true, cancelable: true })
		);
	});
	await field.evaluate((node) => {
		const files = new DataTransfer();
		files.items.add(new File(['a note'], 'pasted.txt', { type: 'text/plain' }));
		node.dispatchEvent(
			new ClipboardEvent('paste', { clipboardData: files, bubbles: true, cancelable: true })
		);
	});
	const attached = panel(page).getByRole('list', { name: 'Attached files' });
	await expect(attached.getByRole('listitem')).toHaveCount(2);
	await expect(attached).toContainText('dropped.csv');
	await expect(attached).toContainText('pasted.txt');
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect(field).toHaveValue(`${key}\nsecond line\nthird line`);
	await attached.getByRole('button', { name: 'Remove dropped.csv' }).click();
	await attached.getByRole('button', { name: 'Remove pasted.txt' }).click();
	await expect(attached).toHaveCount(0);

	await field.press('Enter');
	await expect(thread(page).getByText('Two lines.')).toBeVisible();
	await expect(field).toHaveValue('');
	expect((await field.boundingBox())?.height ?? 0).toBeLessThan(one * 1.2);
	expect(await lastTold(context.request, key)).toContain('second line\\nthird line');
});

test('a thread replays byte for byte after a reload, its words on the way to a tool unseen', async ({
	page,
	context,
	account
}) => {
	void account;
	const { table } = await seedLifts(context.request);
	const key = await script(context.request, [
		{
			blocks: [
				{ type: 'note', text: 'Reading first.' },
				{ type: 'text', text: 'Let me look.' },
				{
					type: 'tool',
					id: 'toolu_query',
					name: 'query',
					input: { base: 'Tables', sql: 'select count(*) from "Lifts"' }
				}
			]
		},
		{ blocks: [{ type: 'text', text: 'Two rows in **Lifts**.' }] },
		{ blocks: [{ type: 'text', text: 'Still two.' }] }
	]);
	await page.goto(tablePath(table));
	await ask(page, `${key} how many`);
	await expect(thread(page).locator('strong', { hasText: 'Lifts' })).toBeVisible();
	await expect(thread(page).getByText('Reading first.')).toHaveCount(0);
	await expect(thread(page).getByText('Let me look.')).toHaveCount(0);

	await page.reload();
	await openAsk(page);
	await expect(thread(page).getByText(`${key} how many`)).toBeVisible();
	await expect(thread(page).getByText('Two rows in')).toBeVisible();

	await ask(page, `${key} and now`);
	await expect(thread(page).getByText('Still two.')).toBeVisible();

	const { requests } = await seen(context.request, key);
	const [first, second, third] = requests;
	expect(second.messages.slice(0, first.messages.length)).toEqual(first.messages);
	expect(third.messages.slice(0, second.messages.length)).toEqual(second.messages);
	expect(JSON.stringify(third.messages)).toContain('signature');
	expect(third.body.system).toEqual(first.body.system);
	expect(third.body.tools).toEqual(first.body.tools);
	expect(first.body.output_config).toEqual({ effort: 'low' });
});

test('a declined message leaves the model’s history, and what the turn did stands', async ({
	page,
	context,
	account
}) => {
	void account;
	const { table } = await seedLifts(context.request);
	const key = await script(context.request, [
		{ blocks: [], stop: 'refusal' },
		{ blocks: [{ type: 'text', text: 'Back on track.' }] }
	]);
	await page.goto(tablePath(table));
	await ask(page, `${key} the message that gets declined`);
	await expect(thread(page).getByText('The assistant declined this request.')).toBeVisible();
	await expect(thread(page).getByRole('button', { name: 'Retry' })).toHaveCount(0);

	await ask(page, `${key} something else`);
	await expect(thread(page).getByText('Back on track.')).toBeVisible();
	const { requests } = await seen(context.request, key);
	expect(JSON.stringify(requests.at(-1)?.messages)).not.toContain('the message that gets declined');
});

test('with no key on the server there is no entry at all, and the app still works', async ({
	page,
	context,
	account
}) => {
	void account;
	const { table } = await seedLifts(context.request);
	await page.route('**/api/health', async (route) => {
		const response = await route.fetch();
		await route.fulfill({ response, json: { ...(await response.json()), assistant: false } });
	});
	await page.goto(tablePath(table));
	await expect(page.getByRole('heading', { name: 'Lifts' })).toBeVisible();
	await expect(page.getByRole('gridcell', { name: 'Bench' })).toBeVisible();
	await expect(page.getByRole('button', { name: /^Ask/u })).toHaveCount(0);
	await expect(panel(page)).toHaveCount(0);
});
