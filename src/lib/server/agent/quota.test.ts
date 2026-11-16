import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createUser } from '../auth/accounts.ts';
import type { AiLimits } from '../config.ts';
import type { Database } from '../db/client.ts';
import { createDatabase } from '../db/client.ts';
import { runMigrations } from '../db/migrate.ts';
import type { User } from '../db/schema.ts';
import { WINDOW_MS, recordUsage, usageRefusal } from './quota.ts';

const T0 = Date.UTC(2026, 10, 1, 9, 0);
const MINUTE = 60_000;

const at = (minutes: number): Date => new Date(T0 + minutes * MINUTE);

function limits(account: number, instance: number, unlimited: string[] = []): AiLimits {
	return { account, instance, unlimited: new Set(unlimited) };
}

const dirs: string[] = [];
const open: Database[] = [];

afterEach(() => {
	for (const db of open.splice(0)) db.$client.close();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function database(file = ':memory:'): Database {
	const db = createDatabase(file);
	runMigrations(db);
	open.push(db);
	return db;
}

function people(db: Database, ...emails: string[]): Promise<User[]> {
	return Promise.all(emails.map((email) => createUser(db, email, 'correct horse')));
}

/** A response that cost `dollars`: Opus 5.5 output is $20 per million tokens. */
function spend(db: Database, user: User, caps: AiLimits, minute: number, dollars: number): void {
	recordUsage(db, user, caps, 'claude-opus-5-5', { output_tokens: dollars * 50_000 }, at(minute));
}

describe('the account budget', () => {
	it('lets calls run until the day’s spending reaches it, then until enough leaves the window', async () => {
		const db = database();
		const [me] = await people(db, 'me@example.com');
		const caps = limits(1, 0);

		spend(db, me, caps, 0, 0.4);
		spend(db, me, caps, 10, 0.4);
		expect(usageRefusal(db, me, caps, at(11))).toBeNull();
		spend(db, me, caps, 20, 0.3);
		expect(usageRefusal(db, me, caps, at(21))).toEqual({
			scope: 'account',
			until: T0 + WINDOW_MS
		});
		expect(usageRefusal(db, me, caps, at(24 * 60))).toBeNull();
	});

	it('names when a lowered budget frees again', async () => {
		const db = database();
		const [me] = await people(db, 'me@example.com');

		for (let minute = 0; minute < 5; minute += 1) spend(db, me, limits(5, 0), minute, 0.2);
		expect(usageRefusal(db, me, limits(0.5, 0), at(10))).toEqual({
			scope: 'account',
			until: at(2).getTime() + WINDOW_MS
		});
	});

	it('is per account', async () => {
		const db = database();
		const [me, you] = await people(db, 'me@example.com', 'you@example.com');
		const caps = limits(1, 0);

		spend(db, me, caps, 0, 1);
		expect(usageRefusal(db, me, caps, at(1))?.scope).toBe('account');
		expect(usageRefusal(db, you, caps, at(1))).toBeNull();
	});

	it('is lifted by 0', async () => {
		const db = database();
		const [me] = await people(db, 'me@example.com');

		spend(db, me, limits(0, 0), 0, 100);
		expect(usageRefusal(db, me, limits(0, 0), at(1))).toBeNull();
	});

	it('survives a restart', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'torsel-quota-'));
		dirs.push(dir);
		const file = join(dir, 'torsel.db');
		const caps = limits(1, 0);

		const before = database(file);
		const [me] = await people(before, 'me@example.com');
		spend(before, me, caps, 0, 1.2);
		before.$client.close();
		open.splice(open.indexOf(before), 1);

		const after = database(file);
		expect(usageRefusal(after, me, caps, at(2))).toEqual({
			scope: 'account',
			until: T0 + WINDOW_MS
		});
	});
});

describe('the instance budget', () => {
	it('refuses everyone once the accounts together reach it, without blaming any of them', async () => {
		const db = database();
		const [a, b, c] = await people(db, 'a@example.com', 'b@example.com', 'c@example.com');
		const caps = limits(5, 1);

		spend(db, a, caps, 0, 0.5);
		spend(db, b, caps, 1, 0.5);
		expect(usageRefusal(db, c, caps, at(2))).toEqual({
			scope: 'instance',
			until: T0 + WINDOW_MS
		});
		expect(usageRefusal(db, c, caps, at(24 * 60))).toBeNull();
	});

	it('names the account when both are reached', async () => {
		const db = database();
		const [me] = await people(db, 'me@example.com');

		spend(db, me, limits(1, 1), 0, 1);
		expect(usageRefusal(db, me, limits(1, 1), at(1))?.scope).toBe('account');
	});
});

describe('an exempt account', () => {
	it('skips both budgets and its spending counts toward neither', async () => {
		const db = database();
		const [owner, guest] = await people(db, 'owner@example.com', 'guest@example.com');
		const caps = limits(1, 1, ['owner@example.com']);

		spend(db, owner, caps, 0, 10);
		expect(usageRefusal(db, owner, caps, at(1))).toBeNull();
		expect(usageRefusal(db, guest, caps, at(1))).toBeNull();
		spend(db, guest, caps, 2, 1);
		expect(usageRefusal(db, guest, caps, at(3))?.scope).toBe('account');
	});
});
