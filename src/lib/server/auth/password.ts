import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

type ScryptParams = { N: number; r: number; p: number };

export function scryptParams(cheap: boolean): ScryptParams {
	return cheap ? { N: 2 ** 10, r: 8, p: 1 } : { N: 2 ** 17, r: 8, p: 1 };
}

// Defined by vitest.config.ts alone, which hands it over as a string; the server build and plain node (the account scripts) take the strong cost.
const PARAMS: ScryptParams = scryptParams(
	import.meta.env !== undefined && import.meta.env.CHEAP_SCRYPT === 'true'
);
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

const MAX_N = 2 ** 20;
const MAX_R = 32;
const MAX_P = 16;

const MIN_SALT_LENGTH = 8;
const MIN_KEY_LENGTH = 32;

type StoredHash = { params: ScryptParams; salt: Buffer; expected: Buffer };

async function deriveKey(
	password: string,
	salt: Buffer,
	keyLength: number,
	params: ScryptParams
): Promise<Buffer> {
	const { N, r, p } = params;

	// oxlint-disable-next-line promise/avoid-new
	const key = await new Promise<Buffer>((resolve, reject) => {
		scrypt(
			password.normalize('NFKC'),
			salt,
			keyLength,
			{ N, r, p, maxmem: 256 * N * r },
			(error, derived) => {
				if (error) {
					reject(error);
				} else {
					resolve(derived);
				}
			}
		);
	});

	return key;
}

function parseParams(rawN: string, rawR: string, rawP: string): ScryptParams | undefined {
	const N = Number(rawN);
	const r = Number(rawR);
	const p = Number(rawP);

	if (!Number.isInteger(N) || N < 2 || N > MAX_N || 2 ** Math.round(Math.log2(N)) !== N) {
		return undefined;
	}
	if (!Number.isInteger(r) || r < 1 || r > MAX_R) {
		return undefined;
	}
	if (!Number.isInteger(p) || p < 1 || p > MAX_P) {
		return undefined;
	}

	return { N, r, p };
}

function parseStored(stored: string): StoredHash | undefined {
	const parts = stored.split('$');
	if (parts.length !== 6 || parts[0] !== 'scrypt') {
		return undefined;
	}

	const [, rawN, rawR, rawP, rawSalt, rawKey] = parts;
	const params = parseParams(rawN, rawR, rawP);
	if (params === undefined) {
		return undefined;
	}

	const salt = Buffer.from(rawSalt, 'base64');
	const expected = Buffer.from(rawKey, 'base64');
	if (salt.length < MIN_SALT_LENGTH || expected.length < MIN_KEY_LENGTH) {
		return undefined;
	}

	return { params, salt, expected };
}

function formatStored(salt: Buffer, key: Buffer): string {
	const { N, r, p } = PARAMS;

	return ['scrypt', N, r, p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(SALT_LENGTH);

	return formatStored(salt, await deriveKey(password, salt, KEY_LENGTH, PARAMS));
}

export function decoyHash(): string {
	return formatStored(randomBytes(SALT_LENGTH), randomBytes(KEY_LENGTH));
}

export const MIN_PASSWORD_LENGTH = 8;

export function passwordProblem(password: string): string | undefined {
	if (password.normalize('NFKC').length < MIN_PASSWORD_LENGTH) {
		return `password must be at least ${MIN_PASSWORD_LENGTH} characters`;
	}

	return undefined;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	const parsed = parseStored(stored);
	if (parsed === undefined) {
		return false;
	}

	const { params, salt, expected } = parsed;
	const actual = await deriveKey(password, salt, expected.length, params);

	return timingSafeEqual(actual, expected);
}
