import type { AuthToken, User } from '../db/schema.ts';

export type PublicToken = {
	id: string;
	label: string;
	kind: AuthToken['kind'];
	prefix: string;
	createdAt: number;
	lastUsedAt: number | null;
	current: boolean;
};

export type PublicUser = { id: string; email: string; createdAt: number; hasPassword: boolean };

export function publicUser(user: User): PublicUser {
	return {
		id: user.id,
		email: user.email,
		createdAt: user.createdAt.getTime(),
		hasPassword: user.passwordHash !== null
	};
}

export function publicToken(token: AuthToken, current: boolean): PublicToken {
	return {
		id: token.id,
		label: token.label,
		kind: token.kind,
		prefix: token.tokenPrefix,
		createdAt: token.createdAt.getTime(),
		lastUsedAt: token.lastUsedAt === null ? null : token.lastUsedAt.getTime(),
		current
	};
}
