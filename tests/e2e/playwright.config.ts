import { defineConfig, devices } from '@playwright/test';

// Never guess a port: that would drive whatever server is there, with its data.
const targets = process.env.TORSEL_TEST_TARGETS;
if (!targets) {
	throw new Error('TORSEL_TEST_TARGETS is not set: run `bun run test:e2e`');
}
const { desktop, phone, app } = JSON.parse(targets);
const dev = process.env.TORSEL_TEST_DEV === '1';

const desktopDevice = { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } };
const phoneDevice = { ...devices['Pixel 5'], viewport: { width: 390, height: 844 } };

// A context closed mid-precache has crashed the browser, and a spinning page's worker hangs the next tab: a spec about the worker allows it.
const noWorker = { serviceWorkers: 'block' } as const;

export default defineConfig({
	globalSetup: dev ? './global-setup.ts' : undefined,
	forbidOnly: true,
	reporter: [['list']],
	workers: 4,
	// The slowest test takes 5s, and 16s pinned to one core. Each context refetches the dev server's unbundled modules: first paint took a minute at load 45, and a test can load three pages.
	timeout: dev ? 300_000 : 60_000,
	expect: { timeout: dev ? 90_000 : 20_000 },
	outputDir: process.env.TORSEL_TEST_OUTPUT,
	use: {
		locale: 'en-US',
		timezoneId: 'UTC',
		contextOptions: { reducedMotion: 'reduce' },
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure'
	},
	projects: [
		{
			name: 'desktop',
			use: { ...desktopDevice, ...noWorker, baseURL: desktop.base },
			metadata: { database: desktop.database, log: desktop.log },
			testIgnore: 'app-build.spec.ts'
		},
		{
			name: 'phone',
			use: { ...phoneDevice, ...noWorker, baseURL: phone.base },
			metadata: { database: phone.database, log: phone.log },
			testIgnore: 'app-build.spec.ts'
		},
		{
			name: 'app',
			use: { ...phoneDevice, baseURL: app.base },
			metadata: { database: app.database, log: app.log },
			testMatch: 'app-build.spec.ts'
		}
	]
});
