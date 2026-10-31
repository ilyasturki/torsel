import { createHash, randomBytes } from 'node:crypto';

import { eq } from 'drizzle-orm';

import type { Database } from '../db/client.ts';
import { WRITER } from '../db/client.ts';
import type { User } from '../db/schema.ts';
import { users } from '../db/schema.ts';
import { findUserByEmail, insertUser, normalizeEmail } from './accounts.ts';

export type Claim =
	| { outcome: 'owned'; nonce: string }
	| { outcome: 'created' | 'reclaimed'; nonce: string; userId: string };

function claimHash(nonce: string): string {
	return createHash('sha256').update(nonce).digest('base64url');
}

/** The nonce goes back to the claimant alone: a cookie on the web, the response body on a device, which has no cookie jar. */
export function claimAddress(db: Database, email: string, passwordHash: string | null): Claim {
	const nonce = randomBytes(32).toString('base64url');

	return db.transaction((tx) => {
		const found = findUserByEmail(tx, email);

		if (found === undefined) {
			const user = insertUser(tx, {
				email: normalizeEmail(email),
				passwordHash,
				claimNonceHash: claimHash(nonce)
			});
			return { outcome: 'created', nonce, userId: user.id };
		}

		if (found.emailVerifiedAt !== null) {
			return { outcome: 'owned', nonce };
		}

		tx.update(users)
			.set({ passwordHash, claimNonceHash: claimHash(nonce) })
			.where(eq(users.id, found.id))
			.run();

		return { outcome: 'reclaimed', nonce, userId: found.id };
	}, WRITER);
}

export type Proof = { user: User; droppedPassword: boolean };

/** Mail reaches the address, not the claimant: a password survives the first proof only with the claimant's nonce, or it was planted. */
export function proveAddress(db: Database, userId: string, nonce: string | null): Proof | null {
	return db.transaction((tx) => {
		const row = tx.select().from(users).where(eq(users.id, userId)).get();
		if (row === undefined) {
			return null;
		}
		if (row.emailVerifiedAt !== null) {
			return { user: row, droppedPassword: false };
		}

		const vouched =
			nonce !== null && row.claimNonceHash !== null && claimHash(nonce) === row.claimNonceHash;
		const droppedPassword = !vouched && row.passwordHash !== null;

		const user = tx
			.update(users)
			.set({
				emailVerifiedAt: new Date(),
				claimNonceHash: null,
				passwordHash: droppedPassword ? null : row.passwordHash
			})
			.where(eq(users.id, row.id))
			.returning()
			.get();

		return { user, droppedPassword };
	}, WRITER);
}

export type GoogleOutcome =
	{ outcome: 'signed-in'; user: User; droppedPassword: boolean } | { outcome: 'closed' };

/** Google has verified the address, which is what makes linking it to an existing row safe. */
export function googleAccount(
	db: Database,
	email: string,
	sub: string,
	signUpOpen: boolean
): GoogleOutcome {
	return db.transaction((tx) => {
		const linked = tx.select().from(users).where(eq(users.googleSub, sub)).get();
		if (linked !== undefined) {
			return { outcome: 'signed-in', user: linked, droppedPassword: false };
		}

		const found = findUserByEmail(tx, email);

		if (found !== undefined) {
			const droppedPassword = found.emailVerifiedAt === null && found.passwordHash !== null;
			const user = tx
				.update(users)
				.set({
					googleSub: sub,
					emailVerifiedAt: found.emailVerifiedAt ?? new Date(),
					claimNonceHash: null,
					passwordHash: droppedPassword ? null : found.passwordHash
				})
				.where(eq(users.id, found.id))
				.returning()
				.get();
			return { outcome: 'signed-in', user, droppedPassword };
		}

		if (!signUpOpen) {
			return { outcome: 'closed' };
		}

		const user = insertUser(tx, {
			email: normalizeEmail(email),
			googleSub: sub,
			emailVerifiedAt: new Date()
		});
		return { outcome: 'signed-in', user, droppedPassword: false };
	}, WRITER);
}
