import { createHash, randomBytes } from 'node:crypto';

const PREFIX = 'ts_';
const SECRET_BYTES = 32;

const PREFIX_LENGTH = PREFIX.length + 8;

export function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

export function mintToken(): { token: string; tokenHash: string; tokenPrefix: string } {
	const token = PREFIX + randomBytes(SECRET_BYTES).toString('base64url');

	return {
		token,
		tokenHash: hashToken(token),
		tokenPrefix: token.slice(0, PREFIX_LENGTH)
	};
}
