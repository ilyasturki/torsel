import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import { createUser } from '../auth/accounts.ts';
import { createDatabase } from './client.ts';
import { runMigrations } from './migrate.ts';

const dirs: string[] = [];
const children: ReturnType<typeof spawn>[] = [];

function tempFile(): string {
	const dir = mkdtempSync(join(tmpdir(), 'torsel-db-'));
	dirs.push(dir);
	return join(dir, 'test.db');
}

function holdLock(file: string, statement: string, ms: number): Promise<void> {
	const script = `
		const { DatabaseSync } = require('node:sqlite');
		const db = new DatabaseSync(process.argv[1]);
		db.exec(process.argv[2]);
		console.log('held');
		setTimeout(() => { db.exec('commit'); db.close(); }, Number(process.argv[3]));
	`;
	const child = spawn(process.execPath, ['-e', script, file, statement, String(ms)], {
		stdio: ['ignore', 'pipe', 'inherit']
	});
	children.push(child);
	return new Promise((resolve, reject) => {
		child.stdout?.once('data', () => resolve());
		child.once('error', reject);
	});
}

afterEach(() => {
	for (const child of children.splice(0)) child.kill();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('createDatabase beside another process', () => {
	it('waits for the lock while opening, not only once it is open', async () => {
		const file = tempFile();
		const setup = new DatabaseSync(file);
		setup.exec('create table t (a)');
		setup.close();

		await holdLock(file, 'begin exclusive', 500);

		const db = createDatabase(file);
		expect(db.$client.prepare('pragma journal_mode').get()).toEqual({ journal_mode: 'wal' });
		db.$client.close();
	});

	it('waits for a writer instead of failing the write', async () => {
		const file = tempFile();
		const setup = createDatabase(file);
		runMigrations(setup);
		setup.$client.close();

		const db = createDatabase(file);
		await holdLock(file, 'begin immediate', 500);

		const user = await createUser(db, 'me@example.com', 'correct horse');
		expect(user.email).toBe('me@example.com');
		db.$client.close();
	});

	it('gives a slow writer far longer than a loaded machine has needed', () => {
		const db = createDatabase(tempFile());
		expect(db.$client.prepare('pragma busy_timeout').get()).toEqual({ timeout: 30_000 });
		db.$client.close();
	});
});
