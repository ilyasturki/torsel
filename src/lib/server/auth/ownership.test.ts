import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Database } from '../db/client.ts';
import { createDatabase } from '../db/client.ts';
import { runMigrations } from '../db/migrate.ts';
import { syncCounters, users } from '../db/schema.ts';
import { createUser, findUserByEmail, verifyLogin } from './accounts.ts';
import { claimAddress, googleAccount, proveAddress } from './ownership.ts';
import { hashPassword } from './password.ts';

let db: Database;
const EMAIL = 'me@example.com';
const PASSWORD = 'correct horse battery';

beforeEach(() => {
	db = createDatabase(':memory:');
	runMigrations(db);
});

afterEach(() => {
	db.$client.close();
});

async function claim(password: string | null = PASSWORD) {
	const result = claimAddress(db, EMAIL, password === null ? null : await hashPassword(password));
	if (result.outcome === 'owned') {
		throw new Error('expected a claim');
	}
	return result;
}

describe('claimAddress', () => {
	it('creates an unverified row with a sync counter', async () => {
		const { userId, outcome } = await claim();

		const row = db.select().from(users).where(eq(users.id, userId)).get();
		expect(outcome).toBe('created');
		expect(row?.emailVerifiedAt).toBeNull();
		expect(
			db.select().from(syncCounters).where(eq(syncCounters.userId, userId)).get()
		).toBeDefined();
	});

	it('leaves a proven address untouched', async () => {
		const owner = await createUser(db, EMAIL, PASSWORD);

		expect(claimAddress(db, EMAIL, await hashPassword('attacker password')).outcome).toBe('owned');
		expect((await verifyLogin(db, EMAIL, PASSWORD))?.id).toBe(owner.id);
	});

	it('hands an unproven address to the latest claimant', async () => {
		const first = await claim('first password');
		const second = await claim('second password');

		expect(second.outcome).toBe('reclaimed');
		expect(proveAddress(db, second.userId, first.nonce)?.droppedPassword).toBe(true);
	});
});

describe('proveAddress', () => {
	it('keeps the password when the claimant proves the address', async () => {
		const { userId, nonce } = await claim();

		expect(proveAddress(db, userId, nonce)?.droppedPassword).toBe(false);
		expect((await verifyLogin(db, EMAIL, PASSWORD))?.id).toBe(userId);
	});

	it('drops a password planted by someone who never read the mail', async () => {
		const { userId } = await claim();

		const proof = proveAddress(db, userId, null);

		expect(proof?.droppedPassword).toBe(true);
		expect(proof?.user.emailVerifiedAt).not.toBeNull();
		expect(await verifyLogin(db, EMAIL, PASSWORD)).toBeNull();
	});

	it('drops it on a wrong nonce too', async () => {
		const { userId } = await claim();

		expect(proveAddress(db, userId, 'not the nonce')?.droppedPassword).toBe(true);
	});

	it('has nothing to drop on a password-less claim', async () => {
		const { userId } = await claim(null);

		expect(proveAddress(db, userId, null)?.droppedPassword).toBe(false);
	});

	it('never touches a password once the address is proven', async () => {
		const owner = await createUser(db, EMAIL, PASSWORD);

		expect(proveAddress(db, owner.id, null)?.droppedPassword).toBe(false);
		expect((await verifyLogin(db, EMAIL, PASSWORD))?.id).toBe(owner.id);
	});

	it('spends the nonce with the first proof', async () => {
		const { userId, nonce } = await claim();

		proveAddress(db, userId, nonce);

		expect(findUserByEmail(db, EMAIL)?.claimNonceHash).toBeNull();
	});

	it('answers null for a deleted user', () => {
		expect(proveAddress(db, 'gone', null)).toBeNull();
	});
});

describe('googleAccount', () => {
	it('creates a verified account with no password while sign-up is open', async () => {
		const result = googleAccount(db, EMAIL, 'g1', true);

		if (result.outcome !== 'signed-in') {
			throw new Error('expected a sign-in');
		}
		expect(result.user.emailVerifiedAt).not.toBeNull();
		expect(result.user.passwordHash).toBeNull();
		expect(result.user.googleSub).toBe('g1');
	});

	it('creates nothing while sign-up is closed', () => {
		expect(googleAccount(db, EMAIL, 'g1', false).outcome).toBe('closed');
		expect(findUserByEmail(db, EMAIL)).toBeUndefined();
	});

	it('links an existing account even while sign-up is closed, keeping its password', async () => {
		const owner = await createUser(db, EMAIL, PASSWORD);

		const result = googleAccount(db, EMAIL, 'g1', false);

		expect(result).toMatchObject({ outcome: 'signed-in', droppedPassword: false });
		expect((await verifyLogin(db, EMAIL, PASSWORD))?.id).toBe(owner.id);
	});

	it('drops a password planted on an unproven row', async () => {
		await claim();

		expect(googleAccount(db, EMAIL, 'g1', true)).toMatchObject({
			outcome: 'signed-in',
			droppedPassword: true
		});
		expect(await verifyLogin(db, EMAIL, PASSWORD)).toBeNull();
	});

	it('finds a linked account by its sub after the address changed', () => {
		const first = googleAccount(db, EMAIL, 'g1', true);
		const again = googleAccount(db, 'renamed@example.com', 'g1', false);

		expect(again).toMatchObject({ outcome: 'signed-in' });
		expect(first).toMatchObject({ outcome: 'signed-in' });
		if (again.outcome === 'signed-in' && first.outcome === 'signed-in') {
			expect(again.user.id).toBe(first.user.id);
		}
	});
});
