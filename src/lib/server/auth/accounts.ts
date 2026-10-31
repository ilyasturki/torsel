import { and, eq, ne } from 'drizzle-orm';

import type { Database } from '../db/client.ts';
import type { AuthToken, User } from '../db/schema.ts';
import { authTokens, syncCounters, users } from '../db/schema.ts';
import { decoyHash, hashPassword, passwordProblem, verifyPassword } from './password.ts';
import { mintToken } from './tokens.ts';

export function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

export function emailProblem(email: string): string | undefined {
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalizeEmail(email))) {
		return 'email is not a valid address';
	}

	return undefined;
}

type Queries = Pick<Database, 'select' | 'insert' | 'update'>;

export function findUserByEmail(db: Queries, email: string): User | undefined {
	return db
		.select()
		.from(users)
		.where(eq(users.email, normalizeEmail(email)))
		.get();
}

export function listUsers(db: Database): User[] {
	return db.select().from(users).orderBy(users.createdAt).all();
}

export async function createUser(db: Database, email: string, password: string): Promise<User> {
	const problem = emailProblem(email) ?? passwordProblem(password);
	if (problem !== undefined) {
		throw new Error(problem);
	}

	const passwordHash = await hashPassword(password);

	return db.transaction((tx) =>
		insertUser(tx, {
			email: normalizeEmail(email),
			passwordHash,
			emailVerifiedAt: new Date()
		})
	);
}

export function insertUser(
	db: Queries,
	values: Pick<User, 'email'> &
		Partial<Pick<User, 'passwordHash' | 'emailVerifiedAt' | 'googleSub' | 'claimNonceHash'>>
): User {
	const user = db
		.insert(users)
		.values({ id: crypto.randomUUID(), createdAt: new Date(), ...values })
		.returning()
		.get();

	db.insert(syncCounters).values({ userId: user.id }).run();
	return user;
}

export async function setPassword(db: Database, userId: string, password: string): Promise<void> {
	const problem = passwordProblem(password);
	if (problem !== undefined) {
		throw new Error(problem);
	}

	const passwordHash = await hashPassword(password);

	db.update(users).set({ passwordHash }).where(eq(users.id, userId)).run();
}

export function deleteUser(db: Database, email: string): boolean {
	const removed = db
		.delete(users)
		.where(eq(users.email, normalizeEmail(email)))
		.returning({ id: users.id })
		.get();

	return removed !== undefined;
}

const DECOY_HASH = decoyHash();

export async function verifyLogin(
	db: Database,
	email: string,
	password: string
): Promise<User | null> {
	const user = findUserByEmail(db, email);

	const correct = await verifyPassword(password, user?.passwordHash ?? DECOY_HASH);

	return correct && user?.passwordHash != null ? user : null;
}

export function issueToken(
	db: Database,
	userId: string,
	label: string,
	kind: AuthToken['kind'],
	expiresAt: Date | null = null
): { token: string; record: AuthToken } {
	const { token, tokenHash, tokenPrefix } = mintToken();

	const record = db
		.insert(authTokens)
		.values({
			id: crypto.randomUUID(),
			userId,
			label: label.trim(),
			kind,
			tokenHash,
			tokenPrefix,
			createdAt: new Date(),
			expiresAt
		})
		.returning()
		.get();

	return { token, record };
}

export function listTokens(db: Database, userId: string): AuthToken[] {
	return db
		.select()
		.from(authTokens)
		.where(eq(authTokens.userId, userId))
		.orderBy(authTokens.createdAt)
		.all();
}

export function revokeToken(db: Database, userId: string, tokenId: string): boolean {
	const removed = db
		.delete(authTokens)
		.where(and(eq(authTokens.id, tokenId), eq(authTokens.userId, userId)))
		.returning({ id: authTokens.id })
		.get();

	return removed !== undefined;
}

export function revokeOtherTokens(db: Database, userId: string, keep: string | null): number {
	const scope =
		keep === null
			? eq(authTokens.userId, userId)
			: and(eq(authTokens.userId, userId), ne(authTokens.id, keep));

	return db.delete(authTokens).where(scope).returning({ id: authTokens.id }).all().length;
}
