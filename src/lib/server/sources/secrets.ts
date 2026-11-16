import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { databasePath } from '../db/config.ts';
import { envText } from '../env.ts';

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export const KEY_FILE = 'secrets.key';

function fromEnv(raw: string): Buffer {
	const key = /^[0-9a-f]{64}$/iu.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
	if (key.length !== KEY_BYTES) {
		throw new Error('TORSEL_SECRETS_KEY must be 32 bytes, as 64 hex digits or base64');
	}
	return key;
}

/** The key beside the database, made on first start; several servers sharing a directory agree on one. */
export function keyFile(dir: string): Buffer {
	const file = path.join(dir, KEY_FILE);
	// Written whole elsewhere, then linked in: a server starting beside this one never reads half a key.
	const draft = `${file}.${process.pid}.${randomBytes(4).toString('hex')}`;
	mkdirSync(dir, { recursive: true });
	writeFileSync(draft, randomBytes(KEY_BYTES).toString('base64'), { flag: 'wx', mode: 0o600 });
	try {
		linkSync(draft, file);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
	} finally {
		unlinkSync(draft);
	}
	const key = Buffer.from(readFileSync(file, 'utf8').trim(), 'base64');
	if (key.length !== KEY_BYTES) {
		throw new Error(`${file} does not hold a 32-byte key`);
	}
	return key;
}

let cached: Buffer | undefined;

function serverKey(): Buffer {
	if (cached === undefined) {
		const raw = envText('TORSEL_SECRETS_KEY', '');
		cached =
			raw !== ''
				? fromEnv(raw)
				: databasePath === ':memory:'
					? randomBytes(KEY_BYTES)
					: keyFile(path.dirname(path.resolve(databasePath)));
	}
	return cached;
}

/** Loads the key now, so a missing or broken one stops the server at start rather than at a run. */
export function loadSecretsKey(): void {
	serverKey();
}

/** `bound` ties the ciphertext to its source, so it opens nowhere else. */
export function seal(plain: string, bound: string, key: Buffer = serverKey()): string {
	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	cipher.setAAD(Buffer.from(bound));
	const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
	return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

/** The plain secret, or null when it was sealed under another key or for another source. */
export function open(sealed: string, bound: string, key: Buffer = serverKey()): string | null {
	const raw = Buffer.from(sealed, 'base64');
	if (raw.length < IV_BYTES + TAG_BYTES) return null;
	try {
		const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, IV_BYTES));
		decipher.setAAD(Buffer.from(bound));
		decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
		return Buffer.concat([
			decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
			decipher.final()
		]).toString('utf8');
	} catch {
		return null;
	}
}

/** What may be shown of a secret: its last four characters. */
export function hintOf(secret: string): string {
	return secret.length <= 8 ? '' : secret.slice(-4);
}
