import { eq } from 'drizzle-orm';

import type { Database } from '../db/client.ts';
import type { AuthToken, User } from '../db/schema.ts';
import { authTokens, users } from '../db/schema.ts';
import { envText } from '../env.ts';
import { issueToken, revokeToken } from './accounts.ts';
import { hashToken } from './tokens.ts';

export const SESSION_COOKIE = 'torsel_session';

const COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

export function webCredentialExpiry(now: Date = new Date()): Date {
	return new Date(now.getTime() + COOKIE_MAX_AGE_SECONDS * 1000);
}

const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

export type Credential = { user: User; token: AuthToken };

export type SessionCookieOptions = {
	path: string;
	httpOnly: boolean;
	sameSite: 'lax';
	secure: boolean;
	maxAge: number;
};

// adapter-node reads no ORIGIN at runtime and calls a request https unless a proxy header says otherwise.
export function secureCookies(url: URL): boolean {
	return envText('ORIGIN', url.origin).startsWith('https:');
}

export function sessionCookieOptions(url: URL): SessionCookieOptions {
	return {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: secureCookies(url),
		maxAge: COOKIE_MAX_AGE_SECONDS
	};
}

export function bearerToken(request: Request): string | null {
	const [scheme, value] = (request.headers.get('authorization') ?? '').split(' ');
	if (scheme === undefined || scheme.toLowerCase() !== 'bearer') {
		return null;
	}
	if (value === undefined || value === '') {
		return null;
	}

	return value;
}

function touch(db: Database, token: AuthToken, now: Date): void {
	if (token.lastUsedAt !== null && now.getTime() - token.lastUsedAt.getTime() < TOUCH_INTERVAL_MS) {
		return;
	}

	db.update(authTokens).set({ lastUsedAt: now }).where(eq(authTokens.id, token.id)).run();
}

export function resolveCredential(db: Database, secret: string | null): Credential | null {
	if (secret === null || secret === '') {
		return null;
	}

	const hash = hashToken(secret);

	const row = db
		.select({ user: users, token: authTokens })
		.from(authTokens)
		.innerJoin(users, eq(users.id, authTokens.userId))
		.where(eq(authTokens.tokenHash, hash))
		.get();

	if (row === undefined) {
		return null;
	}

	const now = new Date();
	if (row.token.expiresAt !== null && row.token.expiresAt.getTime() <= now.getTime()) {
		return null;
	}

	touch(db, row.token, now);

	return row;
}

export function startWebSession(
	db: Database,
	userId: string,
	previous: Credential | null
): { token: string; record: AuthToken } {
	if (previous !== null && previous.token.kind === 'web' && previous.user.id === userId) {
		revokeToken(db, userId, previous.token.id);
	}

	return issueToken(db, userId, 'Web', 'web', webCredentialExpiry());
}
