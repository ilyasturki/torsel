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
import { WINDOW_MS, promptRefusal, takePrompt } from './quota.ts';

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

describe('the account cap', () => {
	it('takes N prompts in a day and refuses the next until the first leaves the window', async () => {
		const db = database();
		const [me] = await people(db, 'me@example.com');
		const caps = limits(3, 0);

		expect(takePrompt(db, me, caps, at(0))).toBeNull();
		expect(takePrompt(db, me, caps, at(10))).toBeNull();
		expect(takePrompt(db, me, caps, at(20))).toBeNull();
		expect(takePrompt(db, me, caps, at(30))).toEqual({
			scope: 'account',
			until: T0 + WINDOW_MS
		});

		expect(takePrompt(db, me, caps, at(24 * 60 - 1))).not.toBeNull();
		expect(takePrompt(db, me, caps, at(24 * 60))).toBeNull();
		expect(takePrompt(db, me, caps, at(24 * 60 + 1))).toEqual({
			scope: 'account',
			until: at(10).getTime() + WINDOW_MS
		});
	});

	it('does not count a refused prompt', async () => {
		const db = database();
		const [me] = await people(db, 'me@example.com');
		const caps = limits(1, 0);

		takePrompt(db, me, caps, at(0));
		for (let minute = 1; minute < 60; minute += 1) {
			takePrompt(db, me, caps, at(minute));
		}
		expect(takePrompt(db, me, caps, at(24 * 60))).toBeNull();
	});

	it('is per account', async () => {
		const db = database();
		const [me, you] = await people(db, 'me@example.com', 'you@example.com');
		const caps = limits(1, 0);

		expect(takePrompt(db, me, caps, at(0))).toBeNull();
		expect(takePrompt(db, me, caps, at(1))?.scope).toBe('account');
		expect(takePrompt(db, you, caps, at(2))).toBeNull();
	});

	it('names when a lowered cap frees a prompt again', async () => {
		const db = database();
		const [me] = await people(db, 'me@example.com');

		for (let minute = 0; minute < 5; minute += 1) {
			takePrompt(db, me, limits(5, 0), at(minute));
		}
		expect(takePrompt(db, me, limits(2, 0), at(10))).toEqual({
			scope: 'account',
			until: at(3).getTime() + WINDOW_MS
		});
	});

	it('is lifted by 0', async () => {
		const db = database();
		const [me] = await people(db, 'me@example.com');

		for (let minute = 0; minute < 100; minute += 1) {
			expect(takePrompt(db, me, limits(0, 0), at(minute))).toBeNull();
		}
	});

	it('survives a restart', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'torsel-quota-'));
		dirs.push(dir);
		const file = join(dir, 'torsel.db');
		const caps = limits(2, 0);

		const before = database(file);
		const [me] = await people(before, 'me@example.com');
		takePrompt(before, me, caps, at(0));
		takePrompt(before, me, caps, at(1));
		before.$client.close();
		open.splice(open.indexOf(before), 1);

		const after = database(file);
		expect(takePrompt(after, me, caps, at(2))).toEqual({
			scope: 'account',
			until: T0 + WINDOW_MS
		});
	});
});

describe('the instance cap', () => {
	it('refuses everyone once the accounts together reach M, without blaming any of them', async () => {
		const db = database();
		const [a, b, c] = await people(db, 'a@example.com', 'b@example.com', 'c@example.com');
		const caps = limits(5, 3);

		expect(takePrompt(db, a, caps, at(0))).toBeNull();
		expect(takePrompt(db, b, caps, at(1))).toBeNull();
		expect(takePrompt(db, a, caps, at(2))).toBeNull();
		expect(takePrompt(db, c, caps, at(3))).toEqual({
			scope: 'instance',
			until: T0 + WINDOW_MS
		});
		expect(takePrompt(db, c, caps, at(24 * 60))).toBeNull();
	});

	it('names the account when both caps are reached', async () => {
		const db = database();
		const [me] = await people(db, 'me@example.com');

		takePrompt(db, me, limits(1, 1), at(0));
		expect(takePrompt(db, me, limits(1, 1), at(1))?.scope).toBe('account');
	});

	it('is lifted by 0', async () => {
		const db = database();
		const users = await people(db, 'a@example.com', 'b@example.com', 'c@example.com');

		for (const user of users) {
			expect(takePrompt(db, user, limits(1, 0), at(0))).toBeNull();
		}
	});
});

describe('an exempt account', () => {
	it('skips both caps and does not count toward the instance', async () => {
		const db = database();
		const [owner, guest] = await people(db, 'owner@example.com', 'guest@example.com');
		const caps = limits(1, 1, ['owner@example.com']);

		for (let minute = 0; minute < 10; minute += 1) {
			expect(takePrompt(db, owner, caps, at(minute))).toBeNull();
		}
		expect(takePrompt(db, guest, caps, at(10))).toBeNull();
		expect(takePrompt(db, owner, caps, at(11))).toBeNull();
		expect(takePrompt(db, guest, caps, at(12))?.scope).toBe('account');
	});
});

describe('a look ahead', () => {
	it('refuses as the next prompt would, and takes nothing', async () => {
		const db = database();
		const [me] = await people(db, 'me@example.com');
		const caps = limits(1, 0);

		expect(promptRefusal(db, me, caps, at(0))).toBeNull();
		expect(promptRefusal(db, me, caps, at(0))).toBeNull();
		takePrompt(db, me, caps, at(1));
		expect(promptRefusal(db, me, caps, at(2))).toEqual({
			scope: 'account',
			until: at(1).getTime() + WINDOW_MS
		});
		expect(promptRefusal(db, me, limits(1, 0, ['me@example.com']), at(2))).toBeNull();
	});
});
