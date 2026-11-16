import { createHash, randomBytes } from 'node:crypto';

const SECRET_BYTES = 32;

const VISIBLE_CHARS = 8;

export function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

export function mintToken(prefix = 'ts_'): {
	token: string;
	tokenHash: string;
	tokenPrefix: string;
} {
	const token = prefix + randomBytes(SECRET_BYTES).toString('base64url');

	return {
		token,
		tokenHash: hashToken(token),
		tokenPrefix: token.slice(0, prefix.length + VISIBLE_CHARS)
	};
}
