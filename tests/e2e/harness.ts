import names from '../../src/lib/i18n/names.ts';
import { spawnSync } from 'node:child_process';
import { randomInt, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';

import type { APIRequestContext, BrowserContext, Locator, Page } from '@playwright/test';
import { test as base, expect } from '@playwright/test';

import { PATH, SOURCE } from '../../src/lib/core/access.ts';
import {
	createBase,
	createTable,
	defaultViews,
	insertRows,
	updateRecord
} from '../../src/lib/core/actions.ts';
import { Hlc } from '../../src/lib/core/clock.ts';
import { isId } from '../../src/lib/core/ids.ts';
import type { Change, Rec } from '../../src/lib/core/model.ts';
import { MAX_PUSH } from '../../src/lib/core/protocol.ts';
import { slugify } from '../../src/lib/core/slug.ts';
import { Workspace } from '../../src/lib/core/workspace.ts';
import { createDatabase } from '../../src/lib/server/db/client.ts';
import { loadWorkspace, writeChanges } from '../../src/lib/server/db/records.ts';
import type { FakeStep, FakeSuggestion, FakeTitle } from './fake-anthropic.ts';

export type Account = { email: string; password: string };

const PASSWORD = 'e2e-suite-password-not-secret';

const ROOT = join(import.meta.dirname, '../..');

// Node drops a connection idle for 5s and a loaded machine can reuse it just then; maxRetries only retries that ECONNRESET.
export const RETRY_RESET = { maxRetries: 3 };

export function newAccount(database: string = base.info().project.metadata.database): Account {
	const account = { email: `${randomUUID()}@e2e.test`, password: PASSWORD };
	const created = spawnSync('node', ['scripts/account.ts', 'create', account.email], {
		cwd: ROOT,
		env: { ...process.env, DATABASE_PATH: database },
		input: account.password,
		encoding: 'utf8'
	});
	if (created.status !== 0) {
		throw new Error(`could not create an account: ${created.stderr}`);
	}
	return account;
}

/** `context.request` shares its cookies with the context's pages. */
export async function signIn(context: BrowserContext, account: Account): Promise<void> {
	const response = await context.request.post('/api/auth/login', {
		...RETRY_RESET,
		data: { email: account.email, password: account.password, client: 'web' }
	});
	expect(response.status(), 'sign-in through the API').toBe(204);
}

export function newAddress(): string {
	return `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
}

export function freshEmail(): string {
	return `${randomUUID()}@e2e.test`;
}

export function passwordField(page: Page): Locator {
	return page.locator('input[name="password"]');
}

export async function passwordSignIn(page: Page, account: Account): Promise<void> {
	await page.getByLabel('Email').fill(account.email);
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await passwordField(page).fill(account.password);
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

export const cell = (page: Page, name: string): Locator =>
	page.getByRole('gridcell', { name, exact: true });

/** Picks from the table's "…": an anchored menu from `sm` up, a sheet on a phone. */
export async function tableMenu(page: Page, item: string): Promise<void> {
	await page.getByRole('button', { name: 'More' }).click();
	await page
		.getByRole('menuitem', { name: item })
		.or(page.getByRole('dialog').getByRole('button', { name: item }))
		.click();
}

/** Picks from the home's "…": a menu from `sm` up, with a submenu per base; a sheet on a phone, a group per base. */
export async function homeMenu(page: Page, item: string, baseName?: string): Promise<void> {
	await page.getByRole('banner').getByRole('button', { name: 'More' }).click();
	if (base.info().project.name === 'phone') {
		const sheet = page.getByRole('dialog');
		const scope = baseName === undefined ? sheet : sheet.getByRole('group', { name: baseName });
		await scope
			.getByRole('button', { name: item, exact: true })
			.or(scope.getByRole('link', { name: item, exact: true }))
			.click();
	} else {
		if (baseName !== undefined) await page.getByRole('menuitem', { name: baseName }).click();
		await page.getByRole('menuitem', { name: item, exact: true }).click();
	}
}

/** The view tabs, from `sm` up; a phone lists the views in a menu under the current one's name. */
export const viewStrip = (page: Page): Locator => page.getByRole('group', { name: 'Views' });

/** Opens a view of the table on screen: its tab from `sm` up, the views menu on a phone. */
export async function switchView(page: Page, name: string): Promise<void> {
	if (base.info().project.name === 'phone') {
		await page.locator('[data-view-menu]').click();
		await page.getByRole('menuitem', { name, exact: true }).click();
	} else {
		await viewStrip(page).getByRole('link', { name, exact: true }).click();
	}
}

/** The view on screen is this one, as its tab or the phone's views menu shows it. */
export async function expectView(page: Page, name: string): Promise<void> {
	if (base.info().project.name === 'phone') {
		await expect(page.locator('[data-view-menu]')).toHaveText(name);
	} else {
		await expect(viewStrip(page).getByRole('link', { name, exact: true })).toHaveAttribute(
			'aria-current',
			'page'
		);
	}
}

/** The table on screen has this view `count` times, in its tabs or the phone's views menu. */
export async function expectViewListed(page: Page, name: string, count = 1): Promise<void> {
	if (base.info().project.name === 'phone') {
		await page.locator('[data-view-menu]').click();
		await expect(page.getByRole('menuitem', { name, exact: true })).toHaveCount(count);
		await page.keyboard.press('Escape');
		await expect(page.getByRole('menu')).toHaveCount(0);
	} else {
		await expect(viewStrip(page).getByRole('link', { name, exact: true })).toHaveCount(count);
	}
}

/** Opens the current view's settings: its icon in the header from `sm` up, the table's sheet on a phone. */
export async function viewSettings(page: Page): Promise<void> {
	if (base.info().project.name === 'phone') {
		await page.getByRole('banner').getByRole('button', { name: 'More' }).click();
		await page.getByRole('dialog').getByRole('button', { name: 'View settings' }).click();
	} else {
		await page.getByRole('button', { name: 'View settings', exact: true }).click();
	}
}

/** Adds a view of a type: the "+" by the view tabs from `sm` up, the table's sheet on a phone. */
export async function newView(
	page: Page,
	type: 'Grid' | 'Entry' | 'List' | 'Chart'
): Promise<void> {
	if (base.info().project.name === 'phone') {
		await page.getByRole('button', { name: 'More' }).click();
		await page.getByRole('button', { name: `New ${type.toLowerCase()} view` }).click();
	} else {
		await page.getByRole('button', { name: 'New view' }).click();
		await page.getByRole('menuitem', { name: type, exact: true }).click();
	}
}

/** An item of an anchored menu from `sm` up, a sheet's button on a phone. */
export const menuItem = (page: Page, item: string): Locator =>
	page
		.getByRole('menuitem', { name: item, exact: true })
		.or(page.getByRole('dialog').getByRole('button', { name: item, exact: true }));

/** Picks from a column header's menu. */
export async function columnMenu(page: Page, column: string, item: string): Promise<void> {
	await page.getByRole('columnheader', { name: column, exact: true }).getByRole('button').click();
	await menuItem(page, item).click();
}

/** Picks an option of the app's Select, found by its label. */
export async function pick(select: Locator, option: string | RegExp): Promise<void> {
	await select.click();
	await select
		.page()
		.getByRole('option', { name: option, exact: typeof option === 'string' })
		.click();
}

/** The Undo a change's toast offers, or the Redo an undo's toast offers. */
export const toastButton = (page: Page, name: 'Undo' | 'Redo'): Locator =>
	page.getByRole('status').getByRole('button', { name, exact: true });

/** The header's list of tables, opened from the name it shows. */
export async function tableList(page: Page): Promise<Locator> {
	const list = page.getByRole('listbox', { name: 'Tables' });
	if (!(await list.isVisible())) {
		await page.getByRole('banner').getByRole('heading').getByRole('button').click();
	}
	await expect(list).toBeVisible();
	return list;
}

/** Goes to a table, or a proposed one, through the header's list. */
export async function openTable(page: Page, name: string): Promise<void> {
	await (await tableList(page)).getByRole('option', { name, exact: true }).click();
}

/** The header's list holds `name` `count` times; the list closes again after. */
export async function expectListed(page: Page, name: string | RegExp, count = 1): Promise<void> {
	const list = await tableList(page);
	await expect(list.getByRole('option', { name, exact: typeof name === 'string' })).toHaveCount(
		count
	);
	await page.keyboard.press('Escape');
	await expect(list).toBeHidden();
}

export const allTables = (page: Page): Locator =>
	page.getByRole('banner').getByRole('link', { name: 'All tables' });

/** Out of any text field, which keeps Ctrl+Z for its own text. */
async function leaveField(page: Page): Promise<void> {
	await page.evaluate(() => {
		const active = document.activeElement;
		if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) active.blur();
	});
}

/** The keyboard is the only way back once the toast has gone: no button undoes. */
export async function undo(page: Page): Promise<void> {
	await leaveField(page);
	await page.keyboard.press('ControlOrMeta+z');
}

export async function redo(page: Page): Promise<void> {
	await leaveField(page);
	await page.keyboard.press('ControlOrMeta+Shift+z');
}

export type SignInMail = { link: string | null; code: string };

/** The newest mail the server logged instead of sending to this address. */
export async function mailTo(email: string): Promise<SignInMail> {
	let found: SignInMail | undefined;
	await expect
		.poll(() => {
			const line = readFileSync(base.info().project.metadata.log, 'utf8')
				.split('\n')
				.findLast((text) => text.startsWith('[email]') && text.includes(` to ${email} `));
			const code = line?.match(/\(code: (\d{6})\)/u)?.[1];
			if (line === undefined || code === undefined) {
				return false;
			}
			found = { code, link: line.match(/\(link: (\S+)\)/u)?.[1] ?? null };
			return true;
		}, 'the server logs the mail')
		.toBe(true);
	return found as SignInMail;
}

/** What a connector run does to a table: it fills `fields` from a source, read-only from then on. */
export function syncFromSource(account: Account, table: string, fields: string[]): void {
	const db = createDatabase(base.info().project.metadata.database);
	try {
		const { id } = db.$client
			.prepare('select id from users where email = ?')
			.get(account.email) as {
			id: string;
		};
		const ws = loadWorkspace(db, id);
		const found = ws
			.bases()
			.flatMap((owned) => ws.tables(owned.id))
			.find((candidate) => candidate.name === table);
		if (found === undefined) throw new Error(`no table ${table}`);
		const sourced = ws.fields(found.id).filter((field) => fields.includes(field.name));
		writeChanges(db, { user: id, path: 'connector' }, ws, [
			...updateRecord(ws, found.id, { [SOURCE]: { kind: 'e2e' } }),
			...sourced.flatMap((field) => updateRecord(ws, field.id, { [PATH]: field.name }))
		]);
	} finally {
		db.$client.close();
	}
}

export function expireEmailTokens(): void {
	const db = new DatabaseSync(base.info().project.metadata.database, { timeout: 30_000 });
	db.exec('update email_tokens set expires_at = 0');
	db.close();
}

/** Queues what the fake model answers; a prompt holding the returned key gets these steps. */
export async function script(
	request: APIRequestContext,
	steps: FakeStep[],
	title?: FakeTitle,
	suggest?: FakeSuggestion[],
	followUp?: string
): Promise<string> {
	const key = `script-${randomUUID()}`;
	const response = await request.post(`${process.env.TORSEL_TEST_FAKE ?? ''}/__script?key=${key}`, {
		data: { steps, title, suggest, followUp }
	});
	expect(response.ok()).toBe(true);
	return key;
}

/** A table's address, from ids or names: an id stays as is, a name is spelled as the app spells it. */
export function tablePath(table: string, view?: string): string {
	const segment = (part: string): string => (isId(part) ? part : slugify(part));
	return view === undefined
		? `/app/t/${segment(table)}`
		: `/app/t/${segment(table)}/${segment(view)}`;
}

export async function seed<T>(
	request: APIRequestContext,
	build: (ws: Workspace, commit: (changes: Change[]) => void) => T
): Promise<T> {
	const ws = new Workspace();
	const hlc = new Hlc('e2e');
	const push = new Map<string, Rec>();
	const result = build(ws, (changes) => {
		for (const change of changes) {
			const { rec } = ws.stamp(change, hlc.tick());
			push.set(rec.id, rec);
		}
	});
	const records = [...push.values()];
	for (let from = 0; from < records.length; from += MAX_PUSH) {
		const response = await request.post('/api/sync', {
			...RETRY_RESET,
			data: { watermark: 0, push: records.slice(from, from + MAX_PUSH) }
		});
		expect(response.ok(), 'seeding through /api/sync').toBe(true);
	}
	return result;
}

/** One table with one row, Squat at 100 kg, in a base named Gym; returns its path. */
export function seedLifts(request: APIRequestContext): Promise<string> {
	return seed(request, (ws, commit) => {
		const base = createBase(ws, 'Gym');
		commit(base.changes);
		const lifts = createTable(
			ws,
			base.id,
			'Lifts',
			[
				{ name: 'Exercise', type: 'text' },
				{ name: 'Kg', type: 'number' }
			],
			() => defaultViews(names.en)
		);
		commit(lifts.changes);
		commit(
			insertRows(ws, lifts.id, [{ [lifts.fieldIds[0]]: 'Squat', [lifts.fieldIds[1]]: 100 }]).changes
		);
		return tablePath(lifts.id);
	});
}

export async function editCell(page: Page, from: string, to: string): Promise<void> {
	await cell(page, from).dblclick();
	await page.getByRole('gridcell').getByRole('textbox').fill(to);
	await page.getByRole('gridcell').getByRole('textbox').press('Enter');
	await expect(cell(page, to)).toBeVisible();
}

export const askButton = (page: Page): Locator => page.getByRole('button', { name: /^Ask/u });

/** Whether Ask is offered: in the header, or in the table's sheet on a phone. */
export async function expectAsk(page: Page, offered: boolean): Promise<void> {
	if (base.info().project.name === 'phone' && new URL(page.url()).pathname.startsWith('/app/t/')) {
		await page.getByRole('banner').getByRole('button', { name: 'More' }).click();
		const ask = page.getByRole('dialog').getByRole('button', { name: 'Ask' });
		await expect(ask).toHaveCount(offered ? 1 : 0);
		await page.keyboard.press('Escape');
		await expect(page.getByRole('dialog')).toHaveCount(0);
	} else {
		await expect(askButton(page)).toHaveCount(offered ? 1 : 0);
	}
}

/** Opens Ask: its button in the header, or the table's sheet on a phone, where the header has no room for it. */
export async function openAsk(page: Page, label = 'Ask', more = 'More'): Promise<void> {
	if (base.info().project.name === 'phone' && new URL(page.url()).pathname.startsWith('/app/t/')) {
		await page.getByRole('banner').getByRole('button', { name: more }).click();
		await page.getByRole('dialog').getByRole('button', { name: label }).click();
	} else {
		await page.getByRole('button', { name: new RegExp(`^${label}`, 'u') }).click();
	}
}

export const askPanel = (page: Page): Locator => page.locator('aside[aria-label="Ask"]');

/** On the page of `seedLifts`: the assistant adds a Deadlift by itself, and the panel stays open. */
export async function askAddsDeadlift(page: Page, request: APIRequestContext): Promise<void> {
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
	await openAsk(page);
	await page.getByPlaceholder('Ask about your tables').fill(`${key} log a deadlift`);
	await page.getByRole('button', { name: 'Send' }).click();
	await expect(page.getByTestId('thread').getByText('Logged.')).toBeVisible();
	await expect(page.getByText('2 rows')).toBeVisible();
}

// What says nothing about the app: Vite's client, Chromium's own line for a 4xx the page
// asked for or a request a spec's `setOffline` cut, and SQLite's loader when a spec navigates
// while its wasm still downloads.
const IGNORED_CONSOLE = [
	/\[vite\]/u,
	/Failed to load resource: the server responded with a status of 4\d\d/u,
	/Failed to load resource: net::ERR_INTERNET_DISCONNECTED/u,
	/wasm streaming compile failed: .*(Response body loading was aborted|Failed to fetch)/u,
	/falling back to ArrayBuffer instantiation/u
];

export function watchErrors(page: Page, errors: string[]): void {
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('response', (response) => {
		if (response.status() >= 500) {
			errors.push(`${response.status()} ${response.url()}`);
		}
	});
	page.on('console', (message) => {
		const text = message.text();
		if (message.type() === 'error' && !IGNORED_CONSOLE.some((ignored) => ignored.test(text))) {
			errors.push(`console: ${text}`);
		}
	});
}

type Fixtures = {
	account: Account;
	pageErrors: string[];
};

export const test = base.extend<Fixtures>({
	// Not on the app project: a cross-origin page would need its preflight to allow the header.
	// oxlint-disable-next-line no-empty-pattern
	extraHTTPHeaders: async ({}, use, info) => {
		await use(info.project.name === 'app' ? {} : { 'x-forwarded-for': newAddress() });
	},
	account: async ({ context }, use) => {
		const account = newAccount();
		await signIn(context, account);
		await use(account);
	},
	pageErrors: [
		async ({ page }, use) => {
			const errors: string[] = [];
			watchErrors(page, errors);
			await use(errors);
			expect(errors, 'the page logged errors').toEqual([]);
		},
		{ auto: true }
	]
});

export { expect };

/** A read and write API token of the signed-in account. */
export async function mint(request: APIRequestContext, label = 'e2e'): Promise<string> {
	const minted = await request.post('/api/auth/tokens', { data: { label } });
	expect(minted.status()).toBe(201);
	return ((await minted.json()) as { token: string }).token;
}

/** One MCP tool call with `token`, as a connected tool makes it. */
export async function rpc(
	request: APIRequestContext,
	token: string,
	name: string,
	args: unknown
): Promise<{ isError?: boolean; content: { text: string }[] }> {
	const answer = await request.post('/api/mcp', {
		headers: { authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream' },
		data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }
	});
	const body = await answer.text();
	const json = body.startsWith('{') ? body : (/^data: (.*)$/mu.exec(body)?.[1] ?? '');
	return (JSON.parse(json) as { result: { isError?: boolean; content: { text: string }[] } })
		.result;
}

/** The smallest workbook Excel would open: one sheet, deflated, no styles. */
export function workbook(sheet: string): Buffer {
	const entries: Record<string, string> = {
		'xl/workbook.xml': '<workbook><sheets><sheet name="Sheet1" r:id="rId1"/></sheets></workbook>',
		'xl/_rels/workbook.xml.rels':
			'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
		'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${sheet}</sheetData></worksheet>`
	};
	const parts: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;
	for (const [name, text] of Object.entries(entries)) {
		const data = deflateRawSync(Buffer.from(text));
		const file = Buffer.from(name);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(8, 8);
		local.writeUInt32LE(data.length, 18);
		local.writeUInt16LE(file.length, 26);
		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(8, 10);
		central.writeUInt32LE(data.length, 20);
		central.writeUInt16LE(file.length, 28);
		central.writeUInt32LE(offset, 42);
		parts.push(local, file, data);
		centrals.push(central, file);
		offset += local.length + file.length + data.length;
	}
	const directory = Buffer.concat(centrals);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(Object.keys(entries).length, 10);
	end.writeUInt32LE(directory.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...parts, directory, end]);
}
