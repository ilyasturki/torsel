import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { verifyLogin } from '../auth/accounts.ts';
import { hashPassword } from '../auth/password.ts';
import { createDatabase } from './client.ts';
import { runMigrations } from './migrate.ts';
import { authTokens, records, users } from './schema.ts';

const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function firstMigrationOnly(): string {
	const dir = mkdtempSync(join(tmpdir(), 'torsel-migrations-'));
	dirs.push(dir);
	const [first] = readdirSync('drizzle').sort();
	cpSync(join('drizzle', first), join(dir, first), { recursive: true });
	return dir;
}

describe('the email sign-in migration', () => {
	it('keeps an account and what hangs off it, and counts it as verified', async () => {
		const db = createDatabase(':memory:');
		runMigrations(db, firstMigrationOnly());

		const createdAt = 1_700_000_000_000;
		const hash = await hashPassword('correct horse');
		db.$client
			.prepare('insert into users (id, email, password_hash, created_at) values (?, ?, ?, ?)')
			.run('u1', 'me@example.com', hash, createdAt);
		db.$client
			.prepare(
				'insert into auth_tokens (id, user_id, label, kind, token_hash, token_prefix, created_at) values (?, ?, ?, ?, ?, ?, ?)'
			)
			.run('t1', 'u1', 'Web', 'web', 'hash', 'ts_', createdAt);
		db.$client
			.prepare('insert into records (user_id, id, base_id, seq, record) values (?, ?, ?, ?, ?)')
			.run('u1', 'r1', 'b1', 1, '{}');

		runMigrations(db);

		const user = db.select().from(users).get();
		expect(user?.emailVerifiedAt?.getTime()).toBe(createdAt);
		expect(db.select().from(authTokens).all()).toHaveLength(1);
		expect(db.select().from(records).all()).toHaveLength(1);
		expect((await verifyLogin(db, 'me@example.com', 'correct horse'))?.id).toBe('u1');
		db.$client.close();
	});
});
