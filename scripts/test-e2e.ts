import type { ChildProcess } from 'node:child_process';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, openSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();
const suite = join(root, 'tests/e2e');
// Outside the root: Vite reloads every page when an HTML file appears under it, and Playwright's traces hold some.
const runDir = mkdtempSync(join(tmpdir(), 'torsel-e2e-'));
const bin = join(root, 'node_modules/.bin');

function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const probe = createServer();
		probe.on('error', reject);
		probe.listen(0, '127.0.0.1', () => {
			const address = probe.address();
			probe.close(() => {
				if (address === null || typeof address === 'string') {
					reject(new Error('no port to probe'));
				} else {
					resolve(address.port);
				}
			});
		});
	});
}

function run(command: string, args: string[], cwd: string): void {
	const { status } = spawnSync(command, args, { cwd, stdio: 'inherit' });
	if (status !== 0) {
		throw new Error(`${command} ${args.join(' ')} exited ${status}`);
	}
}

const servers: ChildProcess[] = [];

function boot(name: string, port: number, env: Record<string, string>): void {
	const log = openSync(join(runDir, `${name}.log`), 'a');
	const server = spawn(
		join(bin, 'vite'),
		['dev', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
		{
			cwd: root,
			// Blank, not absent: `.env` only fills what the environment leaves unset.
			env: {
				...process.env,
				ANTHROPIC_API_KEY: '',
				TORSEL_AI_MODEL: '',
				ORIGIN: '',
				MIGRATIONS_DIR: '',
				...env
			},
			stdio: ['ignore', log, log],
			// Its own process group: shutdown reaches what vite spawned.
			detached: true
		}
	);
	servers.push(server);
}

async function ready(url: string): Promise<void> {
	const deadline = Date.now() + 120_000;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
			if (response.ok) {
				return;
			}
		} catch {
			// not listening yet
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(`${url} was not ready within 120s: see ${runDir}`);
}

function shutdown(): void {
	for (const server of servers) {
		if (server.pid !== undefined) {
			try {
				process.kill(-server.pid, 'SIGTERM');
			} catch {
				server.kill('SIGTERM');
			}
		}
	}
}

process.on('SIGINT', () => {
	shutdown();
	process.exit(130);
});
process.on('SIGTERM', () => {
	shutdown();
	process.exit(143);
});

let exitCode = 1;
try {
	run('bun', ['install', '--frozen-lockfile'], suite);
	run(join(bin, 'tsc'), ['-p', 'tests/e2e'], root);

	const [webPort, appPort] = [await freePort(), await freePort()];
	const web = `http://127.0.0.1:${webPort}`;
	const appBuild = `http://127.0.0.1:${appPort}`;
	const database = join(runDir, 'db.sqlite3');

	boot('web', webPort, { DATABASE_PATH: database, CORS_ORIGINS: appBuild });
	boot('app', appPort, {
		BUILD_TARGET: 'app',
		DATABASE_PATH: join(runDir, 'app-build.sqlite3'),
		CORS_ORIGINS: ''
	});
	await ready(`${web}/api/health`);
	await ready(`${appBuild}/api/health`);

	const playwright = spawn(
		join(suite, 'node_modules/.bin/playwright'),
		['test', ...process.argv.slice(2)],
		{
			cwd: suite,
			env: {
				...process.env,
				TORSEL_TEST_BASE: web,
				TORSEL_TEST_APP_BASE: appBuild,
				TORSEL_TEST_DB: database,
				TORSEL_TEST_OUTPUT: join(runDir, 'results')
			},
			stdio: 'inherit'
		}
	);
	const [code] = await once(playwright, 'exit');
	exitCode = typeof code === 'number' ? code : 1;
} catch (error) {
	console.error(`[test:e2e] ${error instanceof Error ? error.message : String(error)}`);
} finally {
	shutdown();
}
if (exitCode === 0) {
	rmSync(runDir, { recursive: true, force: true });
} else {
	console.error(`[test:e2e] server logs and results kept in ${runDir}`);
}
process.exit(exitCode);
