import { defineConfig, devices } from '@playwright/test';

// Never guess a port: that would drive whatever dev server is there, with its data.
const base = process.env.TORSEL_TEST_BASE;
const appBase = process.env.TORSEL_TEST_APP_BASE;
if (!base || !appBase) {
	throw new Error('TORSEL_TEST_BASE is not set: run `bun run test:e2e`');
}

const desktop = { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } };
const phone = { ...devices['Pixel 5'], viewport: { width: 390, height: 844 } };

export default defineConfig({
	globalSetup: './global-setup.ts',
	forbidOnly: true,
	reporter: [['list']],
	// Dev mode compiles each route on its first visit, which can take seconds.
	timeout: 60_000,
	expect: { timeout: 10_000 },
	outputDir: process.env.TORSEL_TEST_OUTPUT,
	use: {
		baseURL: base,
		locale: 'en-US',
		timezoneId: 'UTC',
		contextOptions: { reducedMotion: 'reduce' },
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure'
	},
	projects: [
		{ name: 'desktop', use: desktop, testIgnore: 'app-build.spec.ts' },
		{ name: 'phone', use: phone, testIgnore: 'app-build.spec.ts' },
		{ name: 'app', use: { ...phone, baseURL: appBase }, testMatch: 'app-build.spec.ts' }
	]
});
