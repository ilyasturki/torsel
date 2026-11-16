import type { Locator } from '@playwright/test';

import { expect, seedLifts, test } from './harness.ts';

const SCHEMES = ['light', 'dark'] as const;

const fill = (locator: Locator): Promise<string> =>
	locator.evaluate((element) => getComputedStyle(element).backgroundColor);

const edge = (locator: Locator): Promise<string> =>
	locator.evaluate((element) => getComputedStyle(element).boxShadow);

for (const scheme of SCHEMES) {
	test(`in ${scheme}, the home's actions read as buttons and the table left is marked`, async ({
		page,
		context,
		account
	}) => {
		void account;
		await page.emulateMedia({ colorScheme: scheme });
		const lifts = await seedLifts(context.request);
		await page.goto(lifts);
		await expect(page.getByRole('heading', { name: 'Lifts' })).toBeVisible();
		await page.goto('/app');

		for (const name of ['New table', 'Import', 'New base']) {
			expect(await fill(page.getByRole('button', { name, exact: true }))).not.toBe(
				'rgba(0, 0, 0, 0)'
			);
		}
		expect(await fill(page.getByRole('link', { name: 'Settings' }))).not.toBe('rgba(0, 0, 0, 0)');

		const left = page.locator('main a[data-home-row][aria-current="true"]');
		await expect(left).toContainText('Lifts');
		expect(await edge(left)).toContain('inset');
	});

	test(`in ${scheme}, a row's sheet draws its fields before they are pointed at`, async ({
		page,
		context,
		account
	}) => {
		void account;
		await page.emulateMedia({ colorScheme: scheme });
		await page.goto(await seedLifts(context.request));
		await page.getByRole('button', { name: 'Open row' }).first().click();
		const kg = page.getByRole('dialog').getByLabel('Kg');
		await expect(kg).toHaveValue('100');
		const drawn = await kg.evaluate((element) => {
			for (let at: Element | null = element; at !== null; at = at.parentElement) {
				if (at.getAttribute('role') === 'dialog') return false;
				if (getComputedStyle(at).backgroundColor !== 'rgba(0, 0, 0, 0)') return true;
			}
			return false;
		});
		expect(drawn, 'a fill of its own, between the field and the sheet').toBe(true);
	});
}
