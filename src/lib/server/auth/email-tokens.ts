import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

import { and, eq, gt, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';

import type { Database } from '../db/client.ts';
import { emailTokens } from '../db/schema.ts';
import { hashToken } from './tokens.ts';

export type EmailTokenPurpose = (typeof emailTokens.$inferInsert)['purpose'];

const CODE_LENGTH = 6;

// About 20 bits: this cap carries the code's security, and a re-roll needs a new rate-limited mail.
const MAX_CODE_ATTEMPTS = 5;

const TTL_MS: Record<EmailTokenPurpose, number> = {
	verify: 24 * 60 * 60 * 1000,
	login: 30 * 60 * 1000
};

// Per process and never on disk, so a leaked database can't sweep the million codes; a restart only voids live codes, their links survive.
const CODE_KEY = randomBytes(32);

function hashCode(code: string): Buffer {
	return createHmac('sha256', CODE_KEY).update(code).digest();
}

function sameCode(stored: string | null, expected: Buffer): boolean {
	if (stored === null) {
		return false;
	}

	const candidate = Buffer.from(stored, 'base64url');
	return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function issueEmailToken(
	db: Database,
	userId: string,
	purpose: EmailTokenPurpose
): { token: string; code: string } {
	const now = new Date();

	db.delete(emailTokens)
		.where(
			or(
				lte(emailTokens.expiresAt, now),
				and(
					eq(emailTokens.userId, userId),
					eq(emailTokens.purpose, purpose),
					isNull(emailTokens.usedAt)
				)
			)
		)
		.run();

	const token = randomBytes(32).toString('base64url');
	const code = randomInt(0, 10 ** CODE_LENGTH)
		.toString()
		.padStart(CODE_LENGTH, '0');

	db.insert(emailTokens)
		.values({
			id: crypto.randomUUID(),
			userId,
			purpose,
			tokenHash: hashToken(token),
			codeHash: hashCode(code).toString('base64url'),
			expiresAt: new Date(now.getTime() + TTL_MS[purpose])
		})
		.run();

	return { token, code };
}

export type Consumed = { userId: string; purpose: EmailTokenPurpose };

/** The `used_at is null` guard makes a replay update nothing. */
export function consumeEmailToken(db: Database, token: string): Consumed | null {
	const now = new Date();

	const row = db
		.update(emailTokens)
		.set({ usedAt: now })
		.where(and(eq(emailTokens.tokenHash, hashToken(token)), isNull(emailTokens.usedAt)))
		.returning({
			userId: emailTokens.userId,
			purpose: emailTokens.purpose,
			expiresAt: emailTokens.expiresAt
		})
		.get();

	if (row === undefined || row.expiresAt.getTime() <= now.getTime()) {
		return null;
	}

	return { userId: row.userId, purpose: row.purpose };
}

/** A miss charges every live code of the user; a code at the cap dies alone, its link keeps working. */
export function consumeEmailCode(
	db: Database,
	userId: string,
	code: string
): EmailTokenPurpose | null {
	const now = new Date();
	const live = and(
		eq(emailTokens.userId, userId),
		isNull(emailTokens.usedAt),
		isNotNull(emailTokens.codeHash),
		gt(emailTokens.expiresAt, now)
	);

	const expected = hashCode(code);
	const match = db
		.select({ id: emailTokens.id, codeHash: emailTokens.codeHash })
		.from(emailTokens)
		.where(live)
		.all()
		.find((row) => sameCode(row.codeHash, expected));

	if (match !== undefined) {
		const claimed = db
			.update(emailTokens)
			.set({ usedAt: now })
			.where(and(eq(emailTokens.id, match.id), isNull(emailTokens.usedAt)))
			.returning({ purpose: emailTokens.purpose })
			.get();

		return claimed === undefined ? null : claimed.purpose;
	}

	db.update(emailTokens)
		.set({
			codeAttempts: sql`${emailTokens.codeAttempts} + 1`,
			codeHash: sql`case when ${emailTokens.codeAttempts} + 1 >= ${MAX_CODE_ATTEMPTS} then null else ${emailTokens.codeHash} end`
		})
		.where(live)
		.run();

	return null;
}
