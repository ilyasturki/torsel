import { createHash, timingSafeEqual } from 'node:crypto';

/** An S256 challenge: the base64url SHA-256 of a verifier, 43 characters unpadded. */
export const CHALLENGE = /^[A-Za-z0-9_-]{43}$/u;

const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/u;

export function verifierMatches(verifier: string, challenge: string): boolean {
	if (!VERIFIER.test(verifier)) {
		return false;
	}
	const computed = Buffer.from(createHash('sha256').update(verifier).digest('base64url'));
	const expected = Buffer.from(challenge);
	return computed.length === expected.length && timingSafeEqual(computed, expected);
}
