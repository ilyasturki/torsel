import { randomUUID } from 'node:crypto';

import type { APIRequestContext, Page } from '@playwright/test';

import { createBase, createTable, insertRows } from '../../src/lib/core/actions.ts';
import type { FakeStep } from './fake-anthropic.ts';
import { expect, seed, test } from './harness.ts';

const FAKE = process.env.TORSEL_TEST_FAKE ?? '';

type Seen = {
	requests: { messages: { role: string; content: unknown }[]; body: Record<string, unknown> }[];
	aborted: number;
};

async function script(request: APIRequestContext, steps: FakeStep[]): Promise<string> {
	const key = `script-${randomUUID()}`;
	const response = await request.post(`${FAKE}/__script?key=${key}`, { data: { steps } });
	expect(response.ok()).toBe(true);
	return key;
}

async function seen(request: APIRequestContext, key: string): Promise<Seen> {
	return (await request.get(`${FAKE}/__seen?key=${key}`)).json();
}

function seedLifts(request: APIRequestContext) {
	return seed(request, (ws, commit) => {
		const base = createBase(ws, 'Tables');
		commit(base.changes);
		const table = createTable(ws, base.id, 'Lifts', [
			{ name: 'Exercise', type: 'text' },
			{ name: 'Reps', type: 'number' },
			{ name: 'Kg', type: 'number' }
		]);
		commit(table.changes);
		const rows = insertRows(ws, table.id, [
			{ [table.fieldIds[0]]: 'Bench', [table.fieldIds[1]]: 8, [table.fieldIds[2]]: 80 },
			{ [table.fieldIds[0]]: 'Squat', [table.fieldIds[1]]: 5, [table.fieldIds[2]]: 100 }
		]);
		commit(rows.changes);
		return { base: base.id, table: table.id, rows: rows.ids };
	});
}

async function ask(page: Page, text: string): Promise<void> {
	const panel = page.locator('aside[aria-label="Ask"]');
	if (!(await panel.getByPlaceholder('Ask about your tables').isVisible())) {
		await page.getByRole('button', { name: /^Ask/u }).click();
	}
	await page.getByPlaceholder('Ask about your tables').fill(text);
	await page.getByRole('button', { name: 'Send' }).click();
}

function thread(page: Page) {
	return page.getByTestId('thread');
}

function isPhone(): boolean {
	return test.info().project.name === 'phone';
}

async function closeAsk(page: Page): Promise<void> {
	await page.locator('aside[aria-label="Ask"]').getByRole('button', { name: 'Close' }).click();
}

test('a reply streams in, with its progress note and each tool call as a row', async ({
	page,
	context,
	account
}) => {
	void account;
	const { table } = await seedLifts(context.request);
	const key = await script(context.request, [
		{
			blocks: [
				{ type: 'note', text: 'Looking at the volume.' },
				{
					type: 'tool',
					id: 'toolu_query',
					name: 'query',
					input: { base: 'Tables', sql: 'select * from "Lifts"' }
				},
				{
					type: 'tool',
					id: 'toolu_bad',
					name: 'query',
					input: { base: 'Tables', sql: 'select nope from "Lifts"' }
				}
			]
		},
		{
			blocks: [{ type: 'text', text: 'You lifted **2 sets** so far' }],
			holdAfter: 'You lifted **2 sets** so far'
		}
	]);
	await page.goto(`/app/t/${table}`);

	await ask(page, `${key} how much`);

	const rows = thread(page);
	await expect(rows.getByText('You lifted', { exact: false })).toBeVisible();
	await expect(rows.getByText('Looking at the volume.')).toBeVisible();
	await expect(rows.getByText('Read with SQL: 2 rows')).toBeVisible();
	await expect(rows.getByText('Failed')).toBeVisible();
	await expect(rows.getByText(/no such column/u)).toBeVisible();
	await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
	await expect(rows.locator('strong')).toHaveText('2 sets');

	await rows.getByText('Read with SQL: 2 rows').click();
	await expect(rows.getByText('select * from \\"Lifts\\"')).toBeVisible();
	await expect(rows.getByText('"count": 2')).toBeVisible();

	await context.request.post(`${FAKE}/__release?key=${key}`);
	await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();
	await expect(rows.getByText(key)).toBeVisible();
});

test('rows the assistant adds appear in the table at once, and undo takes them back', async ({
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
					id: 'toolu_add',
					name: 'add_rows',
					input: {
						base: 'Tables',
						table: 'Lifts',
						rows: [{ Exercise: 'Deadlift', Reps: 3, Kg: 140 }]
					}
				}
			]
		},
		{ blocks: [{ type: 'text', text: 'Logged.' }] }
	]);
	await page.goto(`/app/t/${table}`);
	await ask(page, `${key} log a deadlift`);

	const rows = thread(page);
	await expect(rows.getByText('Add 1 row to Lifts')).toBeVisible();
	await expect(rows.getByText('Applied', { exact: true })).toBeVisible();

	if (isPhone()) {
		await rows.getByRole('link', { name: 'Open Lifts' }).click();
		await expect(page.locator('aside[aria-label="Ask"]')).toBeHidden();
	}
	await expect(page).toHaveURL(new RegExp(`/app/t/${table}`, 'u'));
	await expect(page.locator('tr[data-fresh]')).toContainText('Deadlift');
	await expect(page.getByText('3 rows')).toBeVisible();

	if (isPhone()) {
		await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
	} else {
		await rows.getByRole('button', { name: 'Undo' }).click();
		await expect(rows.getByText('Undone', { exact: true })).toBeVisible();
	}
	await expect(page.getByText('2 rows')).toBeVisible();
});

test('a proposed field previews in the table, and accepting it lands it with its waiting rows', async ({
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
					id: 'toolu_field',
					name: 'add_field',
					input: {
						base: 'Tables',
						table: 'Lifts',
						name: 'Volume',
						type: 'formula',
						formula: '"Reps" * "Kg"'
					}
				},
				{
					type: 'tool',
					id: 'toolu_held',
					name: 'add_field',
					input: { base: 'Tables', table: 'Lifts', name: 'Note', type: 'text' }
				}
			]
		},
		{
			blocks: [
				{
					type: 'tool',
					id: 'toolu_rows',
					name: 'add_rows',
					input: {
						base: 'Tables',
						table: 'Lifts',
						rows: [{ Exercise: 'Row', Reps: 10, Kg: 50, Note: 'easy' }]
					}
				}
			]
		},
		{ blocks: [{ type: 'text', text: 'Proposed.' }] },
		{ blocks: [{ type: 'text', text: 'Noted.' }] }
	]);
	await page.goto(`/app/t/${table}`);
	await ask(page, `${key} add a volume column`);

	const rows = thread(page);
	await expect(rows.getByText('New field "Volume" in Lifts')).toBeVisible();
	await expect(rows.getByText('Held until you answer')).toBeVisible();
	await expect(page.getByText('2 proposals waiting')).toBeVisible();

	if (isPhone()) {
		await closeAsk(page);
	}

	const headers = page.getByTestId('proposed-field');
	await expect(headers).toHaveCount(2);
	await expect(page.getByRole('cell', { name: '640', exact: true })).toBeVisible();

	await page.getByRole('button', { name: 'Accept Volume' }).click();
	await expect(headers).toHaveCount(1);
	await expect(page.getByRole('columnheader', { name: /Volume/u })).toBeVisible();
	await expect(page.getByText('2 rows')).toBeVisible();

	await page.getByRole('button', { name: 'Accept Note' }).click();
	await expect(headers).toHaveCount(0);
	await expect(page.getByText('3 rows')).toBeVisible();
	await expect(page.getByRole('cell', { name: 'easy', exact: true })).toBeVisible();

	await ask(page, `${key} thanks`);
	await expect(rows.getByText('Noted.')).toBeVisible();

	const { requests } = await seen(context.request, key);
	const told = JSON.stringify(requests.at(-1)?.messages.at(-1));
	expect(told).toContain('Accepted: New field');
	expect(told).toContain('Volume');
	expect(told).not.toContain('Rejected');
});

test('a rejected proposal leaves the table alone and reaches the model', async ({
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
					id: 'toolu_table',
					name: 'create_table',
					input: { name: 'Sleep', fields: [{ name: 'Hours', type: 'number' }] }
				},
				{
					type: 'tool',
					id: 'toolu_built',
					name: 'add_rows',
					input: { base: 'Tables', table: 'Sleep', rows: [{ Hours: 8 }] }
				}
			]
		},
		{ blocks: [{ type: 'text', text: 'Proposed a table.' }] },
		{ blocks: [{ type: 'text', text: 'Understood.' }] }
	]);
	await page.goto(`/app/t/${table}`);
	await ask(page, `${key} track my sleep`);

	const rows = thread(page);
	await expect(rows.getByText('New table "Sleep"')).toBeVisible();
	await rows.getByRole('button', { name: 'Reject' }).click();
	await expect(rows.getByText('Rejected', { exact: true })).toBeVisible();
	await expect(rows.getByText('Not applied', { exact: true })).toBeVisible();

	await ask(page, `${key} ok`);
	await expect(rows.getByText('Understood.')).toBeVisible();

	if (isPhone()) {
		await closeAsk(page);
	}
	await expect(
		page.getByRole('group', { name: 'Tables' }).getByRole('link', { name: 'Sleep' })
	).toHaveCount(0);

	const { requests } = await seen(context.request, key);
	const told = JSON.stringify(requests.at(-1)?.messages.at(-1));
	expect(told).toContain('Rejected: New table');
	expect(told).toContain('does not exist');
});

test('a proposed view opens as a tab of its own and can be accepted there', async ({
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
					id: 'toolu_view',
					name: 'create_view',
					input: {
						base: 'Tables',
						table: 'Lifts',
						name: 'By kg',
						type: 'chart',
						config: { kind: 'bar', x: 'Exercise', agg: 'sum', y: 'Kg' }
					}
				}
			]
		},
		{ blocks: [{ type: 'text', text: 'There is a chart to look at.' }] }
	]);
	await page.goto(`/app/t/${table}`);
	await ask(page, `${key} chart it`);

	await thread(page).getByRole('link', { name: 'Show in By kg' }).click();
	if (isPhone()) {
		await expect(page.locator('aside[aria-label="Ask"]')).toBeHidden();
	}

	await expect(page.getByTestId('proposed-view')).toBeVisible();
	await expect(page.getByRole('img', { name: /per Exercise/u })).toBeVisible();
	const tabs = page.getByRole('group', { name: 'Views' });
	await expect(tabs.getByRole('link', { name: 'By kg (proposed)' })).toHaveAttribute(
		'aria-current',
		'page'
	);

	await page.getByTestId('proposed-view').getByRole('button', { name: 'Accept' }).click();
	await expect(page.getByTestId('proposed-view')).toHaveCount(0);
	await expect(tabs.getByRole('link', { name: 'By kg', exact: true })).toBeVisible();
	await expect(page.getByRole('img', { name: /per Exercise/u })).toBeVisible();
});

test('a deletion names what goes and asks in the thread', async ({ page, context, account }) => {
	void account;
	const { table, rows: ids } = await seedLifts(context.request);
	const key = await script(context.request, [
		{
			blocks: [
				{
					type: 'tool',
					id: 'toolu_delete',
					name: 'delete_rows',
					input: { base: 'Tables', table: 'Lifts', ids: [ids[0]] }
				}
			]
		},
		{ blocks: [{ type: 'text', text: 'That needs your word.' }] }
	]);
	await page.goto(`/app/t/${table}`);
	await ask(page, `${key} drop the bench set`);

	const rows = thread(page);
	await expect(rows.getByText('Delete 1 row from Lifts')).toBeVisible();
	await expect(rows.getByText('Bench, 8, 80')).toBeVisible();
	await expect(page.getByText('2 rows')).toBeVisible();
	await expect(page.locator('tr[data-doomed]')).toContainText('Bench');

	await rows.getByRole('button', { name: 'Delete' }).click();
	await expect(rows.getByText('Deleted', { exact: true })).toBeVisible();
	await expect(page.getByText('1 row', { exact: true })).toBeVisible();
	await expect(page.locator('tr[data-doomed]')).toHaveCount(0);
});

test('a refusal keeps what the turn already did', async ({ page, context, account }) => {
	void account;
	const { table } = await seedLifts(context.request);
	const key = await script(context.request, [
		{
			blocks: [
				{
					type: 'tool',
					id: 'toolu_add',
					name: 'add_rows',
					input: { base: 'Tables', table: 'Lifts', rows: [{ Exercise: 'Curl', Reps: 12, Kg: 15 }] }
				}
			]
		},
		{ blocks: [{ type: 'text', text: 'partial' }], stop: 'refusal' }
	]);
	await page.goto(`/app/t/${table}`);
	await ask(page, `${key} log a curl`);

	const rows = thread(page);
	await expect(rows.getByText('The assistant declined this request.')).toBeVisible();
	await expect(rows.getByText('Add 1 row to Lifts')).toBeVisible();
	await expect(page.getByText('3 rows')).toBeVisible();

	await page.reload();
	await page.getByRole('button', { name: /^Ask/u }).click();
	await expect(thread(page).getByText('The assistant declined this request.')).toBeVisible();
	await expect(thread(page).getByText('partial')).toHaveCount(0);
});

test('stop ends the reply and the server call, and the thread carries on', async ({
	page,
	context,
	account
}) => {
	void account;
	const { table } = await seedLifts(context.request);
	const key = await script(context.request, [
		{
			blocks: [{ type: 'text', text: 'Counting every set you ever did' }],
			holdAfter: 'Counting every set you ever did'
		},
		{ blocks: [{ type: 'text', text: 'Ok, shorter.' }] }
	]);
	await page.goto(`/app/t/${table}`);
	await ask(page, `${key} count`);

	const rows = thread(page);
	await expect(rows.getByText('Counting every set', { exact: false })).toBeVisible();
	await page.getByRole('button', { name: 'Stop' }).click();
	await expect(rows.getByText('Stopped.')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();

	await expect
		.poll(async () => (await seen(context.request, key)).aborted, 'the upstream call was cut')
		.toBe(1);

	await ask(page, `${key} shorter`);
	await expect(rows.getByText('Ok, shorter.')).toBeVisible();

	const { requests } = await seen(context.request, key);
	const told = JSON.stringify(requests.at(-1)?.messages);
	expect(told).toContain('Counting every set you ever did');
	expect(told).toContain('The person stopped your previous reply');
});

test('a thread comes back after a reload, and replays its history unchanged', async ({
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
				{
					type: 'tool',
					id: 'toolu_query',
					name: 'query',
					input: { base: 'Tables', sql: 'select count(*) from "Lifts"' }
				}
			]
		},
		{ blocks: [{ type: 'text', text: 'Two rows.' }] },
		{ blocks: [{ type: 'text', text: 'Still two.' }] }
	]);
	await page.goto(`/app/t/${table}`);
	await ask(page, `${key} how many`);
	await expect(thread(page).getByText('Two rows.')).toBeVisible();

	await page.reload();
	await page.getByRole('button', { name: /^Ask/u }).click();
	const rows = thread(page);
	await expect(rows.getByText(`${key} how many`)).toBeVisible();
	await expect(rows.getByText('Reading first.')).toBeVisible();
	await expect(rows.getByText('Read with SQL: 1 row')).toBeVisible();
	await expect(rows.getByText('Two rows.')).toBeVisible();

	await ask(page, `${key} and now`);
	await expect(rows.getByText('Still two.')).toBeVisible();

	const { requests } = await seen(context.request, key);
	const [first, second, third] = requests;
	expect(second.messages.slice(0, first.messages.length)).toEqual(first.messages);
	expect(third.messages.slice(0, second.messages.length)).toEqual(second.messages);
	expect(JSON.stringify(third.messages)).toContain('signature');
	expect(third.body.system).toEqual(first.body.system);
	expect(third.body.tools).toEqual(first.body.tools);
});

test('past threads can be listed and reopened, and a new one starts empty', async ({
	page,
	context,
	account
}) => {
	void account;
	const { table } = await seedLifts(context.request);
	const key = await script(context.request, [
		{ blocks: [{ type: 'text', text: 'First answer.' }] }
	]);
	await page.goto(`/app/t/${table}`);
	await ask(page, `${key} first question`);
	const rows = thread(page);
	await expect(rows.getByText('First answer.')).toBeVisible();

	const panel = page.locator('aside[aria-label="Ask"]');
	await panel.getByRole('button', { name: 'New', exact: true }).click();
	await expect(rows.getByText('First answer.')).toHaveCount(0);
	await expect(rows.getByText(/Ask about your tables or say/u)).toBeVisible();

	await panel.getByRole('button', { name: 'Threads' }).click();
	await panel.getByRole('button', { name: /first question/u }).click();
	await expect(rows.getByText('First answer.')).toBeVisible();
});

test('a server error mid-stream shows in the thread, and the next message works', async ({
	page,
	context,
	account
}) => {
	void account;
	const { table } = await seedLifts(context.request);
	const key = await script(context.request, [
		{ blocks: [{ type: 'text', text: 'Starting to answer' }], failAfter: 'Starting to answer' },
		{ blocks: [{ type: 'text', text: 'Back again.' }] }
	]);
	await page.goto(`/app/t/${table}`);
	await ask(page, `${key} go`);

	const rows = thread(page);
	await expect(rows.getByRole('alert')).toHaveText('The assistant stopped responding. Try again.');
	await expect(rows.getByText('Starting to answer')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();

	await ask(page, `${key} again`);
	await expect(rows.getByText('Back again.')).toBeVisible();
});

test('the context line says what the next message is about', async ({ page, context, account }) => {
	test.skip(isPhone(), 'selecting several rows takes a keyboard');
	void account;
	const { table, rows: ids } = await seedLifts(context.request);
	const key = await script(context.request, [{ blocks: [{ type: 'text', text: 'Seen.' }] }]);
	await page.goto(`/app/t/${table}`);

	await page
		.getByRole('button', { name: 'Open row' })
		.first()
		.click({ modifiers: ['Control'] });
	await page
		.getByRole('button', { name: 'Open row' })
		.nth(1)
		.click({ modifiers: ['Control'] });
	await page.getByRole('button', { name: /^Ask/u }).click();
	await expect(page.getByTestId('context')).toHaveText('On Lifts, Grid, 2 rows selected');

	await ask(page, `${key} these two`);
	await expect(thread(page).getByText('Seen.')).toBeVisible();
	await expect(thread(page).getByText('On Lifts, Grid, 2 rows selected')).toBeVisible();

	const { requests } = await seen(context.request, key);
	const told = JSON.stringify(requests[0].messages.at(-1));
	expect(told).toContain(ids[0]);
	expect(told).toContain(ids[1]);

	await page.getByRole('button', { name: 'Clear' }).click();
	await expect(page.getByTestId('context')).toHaveText('On Lifts, Grid');
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
	await page.goto(`/app/t/${table}`);
	await expect(page.getByRole('heading', { name: 'Lifts' })).toBeVisible();
	await expect(page.getByRole('cell', { name: 'Bench' })).toBeVisible();
	await expect(page.getByRole('button', { name: /^Ask/u })).toHaveCount(0);
	await expect(page.locator('aside[aria-label="Ask"]')).toHaveCount(0);
});
