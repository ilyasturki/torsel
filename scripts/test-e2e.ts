import type { ChildProcess } from 'node:child_process';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { cpSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startFake } from '../tests/e2e/fake-anthropic.ts';

const args = process.argv.slice(2);
const dev = args.includes('--dev');
const root = process.cwd();
const suite = join(root, 'tests/e2e');
// Outside the root: Vite reloads every page when an HTML file appears under it, and Playwright's traces hold some.
const runDir = mkdtempSync(join(tmpdir(), 'torsel-e2e-'));
const bin = join(root, 'node_modules/.bin');

type Target = { base: string; database: string; log: string };
type Stack = {
	desktop: Target;
	phone: Target;
	app: Target;
	appServer: string;
	probes: string[];
};

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

function run(
	command: string,
	commandArgs: string[],
	cwd: string,
	env: Record<string, string> = {}
): void {
	const { status } = spawnSync(command, commandArgs, {
		cwd,
		stdio: 'inherit',
		env: { ...process.env, ...env }
	});
	if (status !== 0) {
		throw new Error(`${command} ${commandArgs.join(' ')} exited ${status}`);
	}
}

const servers: ChildProcess[] = [];
let stopFake = (): void => undefined;

// Stands in for Google. A spec sets the profile to answer as a `profile` cookie, base64url, which comes back as the code.
async function startGoogleStub(): Promise<{ url: string; close: () => void }> {
	const stub = createHttpServer((request, response) => {
		const answer = (status: number, body: unknown): void => {
			response.writeHead(status, { 'content-type': 'application/json' });
			response.end(JSON.stringify(body));
		};

		const url = new URL(request.url ?? '/', 'http://stub');

		if (url.pathname === '/auth') {
			const back = new URL(url.searchParams.get('redirect_uri') ?? '');
			const profile = (request.headers.cookie ?? '').match(/profile=([^;]+)/u)?.[1] ?? '';
			back.searchParams.set('code', profile);
			back.searchParams.set('state', url.searchParams.get('state') ?? '');
			response.writeHead(302, { location: back.href });
			response.end();
		} else if (request.url === '/token') {
			let form = '';
			request.on('data', (chunk) => (form += String(chunk)));
			request.on('end', () => {
				const fields = new URLSearchParams(form);
				if (fields.get('client_secret') === 'e2e-secret') {
					answer(200, { access_token: fields.get('code') });
				} else {
					answer(401, {});
				}
			});
		} else if (request.url === '/userinfo') {
			const token = (request.headers.authorization ?? '').replace('Bearer ', '');
			answer(200, JSON.parse(Buffer.from(token, 'base64url').toString()));
		} else {
			answer(404, {});
		}
	});
	stub.listen(0, '127.0.0.1');
	await once(stub, 'listening');
	return {
		url: `http://127.0.0.1:${(stub.address() as AddressInfo).port}`,
		close: () => stub.close()
	};
}

const google = await startGoogleStub();

function boot(
	name: string,
	command: string,
	commandArgs: string[],
	env: Record<string, string> = {}
): void {
	const log = openSync(join(runDir, `${name}.log`), 'a');
	const server = spawn(command, commandArgs, {
		cwd: root,
		// Blank, not absent: `.env` only fills what the environment leaves unset.
		env: {
			...process.env,
			ANTHROPIC_API_KEY: '',
			ANTHROPIC_BASE_URL: '',
			TORSEL_AI_MODEL: '',
			ORIGIN: '',
			MIGRATIONS_DIR: '',
			BREVO_API_KEY: '',
			TORSEL_EMAIL_FROM: '',
			TORSEL_PUBLIC_SIGNUP: '1',
			GOOGLE_CLIENT_ID: 'e2e-client',
			GOOGLE_CLIENT_SECRET: 'e2e-secret',
			TORSEL_GOOGLE_ISSUER: google.url,
			...env
		},
		stdio: ['ignore', log, log],
		// Its own process group: shutdown reaches what it spawned.
		detached: true
	});
	servers.push(server);
}

function bootBuiltServer(name: string, port: number, env: Record<string, string>): Target {
	const base = `http://127.0.0.1:${port}`;
	const database = join(runDir, `${name}.sqlite3`);
	boot(name, 'node', ['build/server/index.js'], {
		HOST: '127.0.0.1',
		PORT: String(port),
		// Unset, the session cookie turns Secure and Playwright's API requests stop sending it over http.
		ORIGIN: base,
		DATABASE_PATH: database,
		// A spec sets its own address, or the limiters' windows would span the whole suite.
		ADDRESS_HEADER: 'x-forwarded-for',
		XFF_DEPTH: '1',
		...env
	});
	return { base, database, log: join(runDir, `${name}.log`) };
}

// Under `build/`, not the run dir: the server resolves its dependencies from `node_modules` above it.
const PREVIOUS_BUILD = 'build/server-previous';

async function builtStack(assistant: Record<string, string>): Promise<Stack> {
	// A rebuild of the same source hashes every asset the same: this define gives the deploy spec files that really differ.
	run('bun', ['run', 'build:server'], root, { DEFAULT_SERVER: 'https://previous-build.test' });
	rmSync(join(root, PREVIOUS_BUILD), { recursive: true, force: true });
	cpSync(join(root, 'build/server'), join(root, PREVIOUS_BUILD), { recursive: true });
	run('bun', ['run', 'build:server'], root);
	run('bun', ['run', 'build:app'], root);

	const [desktopPort, phonePort, appServerPort, appPort] = [
		await freePort(),
		await freePort(),
		await freePort(),
		await freePort()
	];
	const appBase = `http://127.0.0.1:${appPort}`;

	const desktop = bootBuiltServer('desktop', desktopPort, { CORS_ORIGINS: '', ...assistant });
	const phone = bootBuiltServer('phone', phonePort, { CORS_ORIGINS: '', ...assistant });
	const appServer = bootBuiltServer('app-server', appServerPort, {
		CORS_ORIGINS: appBase,
		ADDRESS_HEADER: '',
		...assistant
	});
	boot('app', join(suite, 'node_modules/.bin/sirv'), [
		'build/app',
		'--single',
		'--host',
		'127.0.0.1',
		'--port',
		String(appPort),
		'--quiet'
	]);

	return {
		desktop,
		phone,
		app: { base: appBase, database: appServer.database, log: appServer.log },
		appServer: appServer.base,
		probes: [desktop, phone, appServer].map(({ base }) => `${base}/api/health`).concat(appBase)
	};
}

function bootDevServer(name: string, port: number, env: Record<string, string>): void {
	boot(
		name,
		join(bin, 'vite'),
		['dev', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
		env
	);
}

// Both web projects share one dev server: more would clobber each other's dependency cache.
async function devStack(assistant: Record<string, string>): Promise<Stack> {
	const [webPort, appPort] = [await freePort(), await freePort()];
	const base = `http://127.0.0.1:${webPort}`;
	const appBase = `http://127.0.0.1:${appPort}`;
	const database = join(runDir, 'web.sqlite3');

	bootDevServer('web', webPort, { DATABASE_PATH: database, CORS_ORIGINS: appBase, ...assistant });
	bootDevServer('app', appPort, {
		BUILD_TARGET: 'app',
		DATABASE_PATH: join(runDir, 'app.sqlite3'),
		CORS_ORIGINS: ''
	});

	const log = join(runDir, 'web.log');
	const web = { base, database, log };
	return {
		desktop: web,
		phone: web,
		app: { base: appBase, database, log },
		appServer: base,
		probes: [`${base}/api/health`, `${appBase}/api/health`]
	};
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
	stopFake();
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
	run('bun', ['install', '--frozen-lockfile'], root);
	run('bun', ['install', '--frozen-lockfile'], suite);
	run(join(bin, 'tsc'), ['-p', 'tests/e2e'], root);

	const fake = await startFake();
	stopFake = fake.close;
	const assistant = { ANTHROPIC_API_KEY: 'fake-key', ANTHROPIC_BASE_URL: fake.url };

	const stack = dev ? await devStack(assistant) : await builtStack(assistant);
	await Promise.all(stack.probes.map(ready));

	const playwright = spawn(
		join(suite, 'node_modules/.bin/playwright'),
		['test', ...args.filter((arg) => arg !== '--dev')],
		{
			cwd: suite,
			env: {
				...process.env,
				TORSEL_TEST_TARGETS: JSON.stringify({
					desktop: stack.desktop,
					phone: stack.phone,
					app: stack.app
				}),
				TORSEL_TEST_APP_SERVER: stack.appServer,
				TORSEL_TEST_PREVIOUS_BUILD: PREVIOUS_BUILD,
				TORSEL_TEST_GOOGLE: google.url,
				TORSEL_TEST_DEV: dev ? '1' : '',
				TORSEL_TEST_FAKE: fake.url,
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
	google.close();
}
if (exitCode === 0) {
	rmSync(runDir, { recursive: true, force: true });
} else {
	console.error(`[test:e2e] server logs and results kept in ${runDir}`);
}
process.exit(exitCode);
