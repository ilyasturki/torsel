import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';

import type { APIRequestContext, Page } from '@playwright/test';

import { createBase, createTable, insertRows } from '../../src/lib/core/actions.ts';
import { cell, expect, RETRY_RESET, seed, test, watchErrors } from './harness.ts';

const DEV = process.env.TORSEL_TEST_DEV === '1';
const ROOT = join(import.meta.dirname, '../..');
const PREVIOUS_BUILD = join(ROOT, process.env.TORSEL_TEST_PREVIOUS_BUILD ?? '');
const CURRENT_BUILD = join(ROOT, 'build/server');

function seedLifts(request: APIRequestContext) {
	return seed(request, (ws, commit) => {
		const base = createBase(ws, 'Gym');
		commit(base.changes);
		const lifts = createTable(ws, base.id, 'Lifts', [
			{ name: 'Exercise', type: 'text' },
			{ name: 'Kg', type: 'number' }
		]);
		commit(lifts.changes);
		commit(
			insertRows(ws, lifts.id, [{ [lifts.fieldIds[0]]: 'Squat', [lifts.fieldIds[1]]: 100 }]).changes
		);
		return `/app/t/${lifts.id}`;
	});
}

/** Install only finishes once every file is in the cache, so an active worker means precached. */
function precached(page: Page): Promise<void> {
	return page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
}

function cachedPaths(page: Page): Promise<string[]> {
	return page.evaluate(async () => {
		const paths: string[] = [];
		for (const name of await caches.keys()) {
			const requests = await (await caches.open(name)).keys();
			paths.push(...requests.map((request) => new URL(request.url).pathname));
		}
		return paths;
	});
}

async function newLocalTable(page: Page): Promise<void> {
	await page.goto('/app');
	await page.getByRole('button', { name: 'New table' }).first().click();
	await expect(page.getByRole('heading', { name: 'Table 1' })).toBeVisible();
}

test.describe('in a build', () => {
	test.skip(DEV, 'the worker is only registered in a build');

	test('a reload with no network opens local data, and the new row reaches the server', async ({
		page,
		context,
		account
	}) => {
		void account;
		await page.goto(await seedLifts(context.request));
		await expect(cell(page, 'Squat')).toBeVisible();
		await precached(page);

		await context.setOffline(true);
		const reloaded = await page.reload();
		expect(reloaded?.fromServiceWorker()).toBe(true);
		expect(reloaded?.headers()['content-security-policy']).toContain('nonce-');
		await expect(cell(page, 'Squat')).toBeVisible();
		expect(
			await page.evaluate(() => document.fonts.check('16px "Funnel Sans Variable"')),
			'the font came from the cache'
		).toBe(true);

		await page.getByRole('button', { name: 'Add row' }).click();
		const sheet = page.getByRole('dialog');
		await sheet.getByLabel('Exercise').fill('Deadlift');
		await sheet.getByLabel('Kg').fill('140');
		await sheet.getByLabel('Kg').press('Enter');
		await expect(cell(page, 'Deadlift')).toBeVisible();
		await expect(page.getByText('Offline, 1 change waiting')).toBeVisible();

		await context.setOffline(false);
		await expect
			.poll(async () => {
				const response = await context.request.post('/api/sync', {
					...RETRY_RESET,
					data: { watermark: 0, push: [] }
				});
				return JSON.stringify(await response.json());
			})
			.toContain('Deadlift');

		const paths = await cachedPaths(page);
		expect(paths).toContain('/app');
		expect(paths.some((path) => path.endsWith('.wasm'))).toBe(true);
		expect(paths.some((path) => path.endsWith('.woff2'))).toBe(true);
		expect(paths.filter((path) => path.startsWith('/api'))).toEqual([]);
	});

	test('opens from nothing with no network, the way a home screen icon does', async ({
		page,
		context
	}) => {
		await newLocalTable(page);
		await precached(page);
		await context.setOffline(true);

		const manifest = await page.evaluate(() =>
			fetch('/manifest.webmanifest').then((response) => response.json())
		);
		await page.close();

		const opened = await context.newPage();
		const errors: string[] = [];
		watchErrors(opened, errors);
		await opened.goto(manifest.start_url);
		await expect(opened.getByRole('heading', { name: 'Table 1' })).toBeVisible();

		await opened.goto('/app/settings');
		await expect(opened.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
		expect(errors).toEqual([]);
	});

	test('a server answering 502 or hanging still opens the app', async ({ page, context }) => {
		await newLocalTable(page);
		await precached(page);

		await context.route('**/app/t/*', (route) => route.fulfill({ status: 502, body: 'down' }));
		await page.reload();
		await expect(page.getByRole('heading', { name: 'Table 1' })).toBeVisible();

		await context.unroute('**/app/t/*');
		await context.route('**/app/t/*', () => undefined);
		await page.reload();
		await expect(page.getByRole('heading', { name: 'Table 1' })).toBeVisible();
	});

	test('the landing registers nothing, and stays out of the worker after a visit to the app', async ({
		page
	}) => {
		await page.goto('/');
		await page.waitForTimeout(300);
		expect(
			await page.evaluate(() =>
				navigator.serviceWorker.getRegistrations().then((found) => found.length)
			)
		).toBe(0);

		await page.goto('/app');
		await precached(page);

		await page.goto('/');
		expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
	});

	test('Chromium finds nothing stopping an install', async ({ page, context }) => {
		await page.goto('/app');
		await precached(page);

		const session = await context.newCDPSession(page);
		const { errors } = await session.send('Page.getAppManifest');
		expect(errors).toEqual([]);
		const { installabilityErrors } = await session.send('Page.getInstallabilityErrors');
		// Playwright's contexts are incognito, which only says something about the test.
		expect(installabilityErrors.filter(({ errorId }) => errorId !== 'in-incognito')).toEqual([]);
	});

	test.describe('a deploy', () => {
		const servers: ChildProcess[] = [];

		test.afterEach(() => {
			for (const server of servers.splice(0)) {
				server.kill();
			}
		});

		async function serve(build: string, port: number, database: string): Promise<ChildProcess> {
			const base = `http://127.0.0.1:${port}`;
			const server = spawn('node', [join(build, 'index.js')], {
				cwd: ROOT,
				env: {
					...process.env,
					HOST: '127.0.0.1',
					PORT: String(port),
					ORIGIN: base,
					DATABASE_PATH: database,
					ANTHROPIC_API_KEY: '',
					BREVO_API_KEY: '',
					MIGRATIONS_DIR: ''
				},
				stdio: 'ignore'
			});
			servers.push(server);
			await expect
				.poll(() =>
					fetch(`${base}/api/health`).then(
						(response) => response.ok,
						() => false
					)
				)
				.toBe(true);
			return server;
		}

		function freePort(): Promise<number> {
			return new Promise((resolve) => {
				const probe = createServer();
				probe.listen(0, '127.0.0.1', () => {
					const { port } = probe.address() as { port: number };
					probe.close(() => resolve(port));
				});
			});
		}

		function builtVersion(build: string): string {
			const file = join(build, 'client/_app/version.json');
			return (JSON.parse(readFileSync(file, 'utf8')) as { version: string }).version;
		}

		const inBuild = (build: string) => (path: string) => existsSync(join(build, 'client', path));

		test('takes over at the next reload, with nothing of the old build left', async ({
			page,
			context
		}, info) => {
			const port = await freePort();
			const base = `http://127.0.0.1:${port}`;
			const database = info.outputPath('deploy.sqlite3');
			const previous = await serve(PREVIOUS_BUILD, port, database);

			await page.goto(`${base}/app`);
			await page.getByRole('button', { name: 'New table' }).first().click();
			await expect(page.getByRole('heading', { name: 'Table 1' })).toBeVisible();
			await precached(page);
			const oldTab = await context.newPage();
			await oldTab.goto(page.url());
			await expect(oldTab.getByRole('heading', { name: 'Table 1' })).toBeVisible();

			previous.kill();
			await once(previous, 'exit');
			await serve(CURRENT_BUILD, port, database);

			const loaded: string[] = [];
			page.on('response', (response) => {
				const { pathname } = new URL(response.url());
				if (pathname.startsWith('/_app/immutable/')) {
					loaded.push(pathname);
				}
			});

			await page.reload();
			await expect(page.getByRole('heading', { name: 'Table 1' })).toBeVisible();
			expect(loaded.length).toBeGreaterThan(0);
			expect(loaded.filter((path) => !inBuild(CURRENT_BUILD)(path))).toEqual([]);
			expect(loaded.some((path) => !inBuild(PREVIOUS_BUILD)(path))).toBe(true);

			await expect
				.poll(() => page.evaluate(() => caches.keys()))
				.toEqual([`shell-${builtVersion(CURRENT_BUILD)}`]);

			loaded.length = 0;
			await context.setOffline(true);
			await page.reload();
			await expect(page.getByRole('heading', { name: 'Table 1' })).toBeVisible();
			expect(loaded.length).toBeGreaterThan(0);
			expect(loaded.filter((path) => !inBuild(CURRENT_BUILD)(path))).toEqual([]);
			await context.setOffline(false);

			if (info.project.name === 'phone') {
				await oldTab.getByRole('button', { name: 'More' }).click();
			}
			await oldTab.getByRole('link', { name: 'Settings' }).click();
			await expect(oldTab.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
		});
	});
});

test('a dev server registers no worker', async ({ page }) => {
	test.skip(!DEV, 'only a dev server can show this');
	await newLocalTable(page);
	expect(
		await page.evaluate(() =>
			navigator.serviceWorker.getRegistrations().then((found) => found.length)
		)
	).toBe(0);
});
