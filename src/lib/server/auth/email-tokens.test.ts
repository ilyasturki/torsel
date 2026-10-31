import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '../db/client.ts';
import { createDatabase } from '../db/client.ts';
import { runMigrations } from '../db/migrate.ts';
import { emailTokens, users } from '../db/schema.ts';
import { consumeEmailCode, consumeEmailToken, issueEmailToken } from './email-tokens.ts';
import { hashToken } from './tokens.ts';

let db: Database;
const USER = 'user-1';

beforeEach(() => {
	db = createDatabase(':memory:');
	runMigrations(db);
	db.insert(users).values({ id: USER, email: 'me@example.com', createdAt: new Date() }).run();
});

afterEach(() => {
	vi.useRealTimers();
	db.$client.close();
});

function wrong(code: string): string {
	return code === '000000' ? '000001' : '000000';
}

describe('issueEmailToken', () => {
	it('stores neither the token nor the code in the clear', () => {
		const { token, code } = issueEmailToken(db, USER, 'login');
		const row = db.select().from(emailTokens).get();

		expect(code).toMatch(/^\d{6}$/u);
		expect(row?.tokenHash).toBe(hashToken(token));
		expect(row?.tokenHash).not.toContain(token);
		expect(row?.codeHash).not.toContain(code);
	});

	it('leaves only the newest token of a purpose working', () => {
		const first = issueEmailToken(db, USER, 'login');
		const second = issueEmailToken(db, USER, 'login');

		expect(consumeEmailToken(db, first.token)).toBeNull();
		expect(consumeEmailToken(db, second.token)).toEqual({ userId: USER, purpose: 'login' });
	});

	it('keeps a token of the other purpose', () => {
		const verify = issueEmailToken(db, USER, 'verify');
		issueEmailToken(db, USER, 'login');

		expect(consumeEmailToken(db, verify.token)?.purpose).toBe('verify');
	});

	it('sweeps expired rows', () => {
		vi.useFakeTimers();
		issueEmailToken(db, USER, 'login');
		vi.advanceTimersByTime(31 * 60 * 1000);
		issueEmailToken(db, USER, 'verify');

		expect(
			db
				.select()
				.from(emailTokens)
				.all()
				.map((row) => row.purpose)
		).toEqual(['verify']);
	});
});

describe('consumeEmailToken', () => {
	it('works once', () => {
		const { token } = issueEmailToken(db, USER, 'login');

		expect(consumeEmailToken(db, token)).not.toBeNull();
		expect(consumeEmailToken(db, token)).toBeNull();
	});

	it('refuses an unknown token', () => {
		expect(consumeEmailToken(db, 'nope')).toBeNull();
	});

	it.each([
		['login', 30 * 60 * 1000],
		['verify', 24 * 60 * 60 * 1000]
	] as const)('expires a %s token after its TTL', (purpose, ttl) => {
		vi.useFakeTimers();
		const before = issueEmailToken(db, USER, purpose);
		vi.advanceTimersByTime(ttl - 1000);
		expect(consumeEmailToken(db, before.token)).not.toBeNull();

		const after = issueEmailToken(db, USER, purpose);
		vi.advanceTimersByTime(ttl + 1);
		expect(consumeEmailToken(db, after.token)).toBeNull();
	});
});

describe('consumeEmailCode', () => {
	it('works once, and spends the link too', () => {
		const { token, code } = issueEmailToken(db, USER, 'login');

		expect(consumeEmailCode(db, USER, code)).toBe('login');
		expect(consumeEmailCode(db, USER, code)).toBeNull();
		expect(consumeEmailToken(db, token)).toBeNull();
	});

	it('is spent by the link', () => {
		const { token, code } = issueEmailToken(db, USER, 'login');

		consumeEmailToken(db, token);
		expect(consumeEmailCode(db, USER, code)).toBeNull();
	});

	it('expires', () => {
		vi.useFakeTimers();
		const { code } = issueEmailToken(db, USER, 'login');
		vi.advanceTimersByTime(30 * 60 * 1000 + 1);

		expect(consumeEmailCode(db, USER, code)).toBeNull();
	});

	it('dies at the guess cap while its link keeps working', () => {
		const { token, code } = issueEmailToken(db, USER, 'login');

		for (let guess = 0; guess < 5; guess += 1) {
			expect(consumeEmailCode(db, USER, wrong(code))).toBeNull();
		}

		expect(consumeEmailCode(db, USER, code)).toBeNull();
		expect(consumeEmailToken(db, token)).not.toBeNull();
	});

	it('survives four wrong guesses', () => {
		const { code } = issueEmailToken(db, USER, 'login');

		for (let guess = 0; guess < 4; guess += 1) {
			consumeEmailCode(db, USER, wrong(code));
		}

		expect(consumeEmailCode(db, USER, code)).toBe('login');
	});

	it('does not count a guess against another user', () => {
		db.insert(users)
			.values({ id: 'user-2', email: 'other@example.com', createdAt: new Date() })
			.run();
		const mine = issueEmailToken(db, USER, 'login');
		issueEmailToken(db, 'user-2', 'login');

		consumeEmailCode(db, 'user-2', wrong(mine.code));

		const row = db.select().from(emailTokens).where(eq(emailTokens.userId, USER)).get();
		expect(row?.codeAttempts).toBe(0);
	});
});
