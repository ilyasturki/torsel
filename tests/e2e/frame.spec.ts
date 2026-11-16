import names from '../../src/lib/i18n/names.ts';
import type { APIRequestContext, Page } from '@playwright/test';

import {
	createBase,
	createTable,
	createView,
	defaultViews,
	insertRows
} from '../../src/lib/core/actions.ts';
import { expect, expectView, seed, switchView, tablePath, test, viewSettings } from './harness.ts';

function seedEveryView(request: APIRequestContext): Promise<{ table: string; views: string[] }> {
	return seed(request, (ws, commit) => {
		const base = createBase(ws, 'Gym');
		commit(base.changes);
		const lifts = createTable(
			ws,
			base.id,
			'Lifts',
			[
				{ name: 'Date', type: 'date' },
				{ name: 'Kg', type: 'number' }
			],
			() => defaultViews(names.en)
		);
		commit(lifts.changes);
		const [date, kg] = lifts.fieldIds;
		commit(insertRows(ws, lifts.id, [{ [date]: '2026-10-26', [kg]: 100 }]).changes);
		const list = createView(ws, lifts.id, { name: 'Log', type: 'list', config: {} });
		commit(list.changes);
		const chart = createView(ws, lifts.id, {
			name: 'Trend',
			type: 'chart',
			config: { kind: 'line', x: date, agg: 'max', y: kg }
		});
		commit(chart.changes);
		return { table: lifts.id, views: [...lifts.viewIds, list.id, chart.id] };
	});
}

async function panelTop(page: Page): Promise<number> {
	await expect(page.locator('main')).toBeVisible();
	return (await page.locator('main').boundingBox())?.y ?? Number.NaN;
}

const onPhone = (): boolean => test.info().project.name === 'phone';

test('the panel starts at the same height on the home, settings and every view', async ({
	page,
	context,
	account
}) => {
	void account;
	const { table, views } = await seedEveryView(context.request);
	const tops: number[] = [];
	await page.goto('/app');
	await expect(page.locator('main a[data-home-row]')).toHaveCount(1);
	tops.push(await panelTop(page));
	await page.goto('/app/settings');
	await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible();
	tops.push(await panelTop(page));
	for (const view of views) {
		await page.goto(tablePath(table, view));
		await expect(page.locator('main')).not.toBeEmpty();
		tops.push(await panelTop(page));
	}
	expect(new Set(tops).size, `panel tops ${tops.join(', ')}`).toBe(1);
	expect(tops[0]).toBeLessThan(80);
});

test('the views sit in the header, as tabs on a desk and a menu on a phone', async ({
	page,
	context,
	account
}) => {
	void account;
	const { table, views } = await seedEveryView(context.request);
	await page.goto(tablePath(table, views[0]));
	await expect(page.getByRole('group', { name: 'Views' })).toBeVisible({ visible: !onPhone() });
	await switchView(page, 'Trend');
	await expectView(page, 'Trend');
	await expect(page).toHaveURL(/\/trend$/u);
});

test('view settings open from the header, or its sheet on a phone', async ({
	page,
	context,
	account
}) => {
	void account;
	const { table, views } = await seedEveryView(context.request);
	await page.goto(tablePath(table, views[2]));
	await viewSettings(page);
	const settings = page.getByRole('dialog', { name: 'View settings' });
	await expect(settings.getByLabel('Name')).toHaveValue('Log');
});

test('on a phone, Ask sits in the table sheet', async ({ page, context, account }) => {
	test.skip(!onPhone(), 'the header has room for Ask from `sm` up');
	void account;
	const { table } = await seedEveryView(context.request);
	await page.goto(tablePath(table));
	await expect(page.getByRole('banner').getByRole('button', { name: /^Ask/u })).toHaveCount(0);
	await page.getByRole('banner').getByRole('button', { name: 'More' }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Ask' }).click();
	await expect(page.locator('aside[aria-label="Ask"]')).toBeVisible();
});

test('the legal title stays below the landing title on a phone', async ({ page }) => {
	test.skip(!onPhone(), 'the legal title grows back on a desk');
	const size = async (): Promise<number> =>
		Number.parseFloat(
			await page
				.getByRole('heading', { level: 1 })
				.first()
				.evaluate((element) => getComputedStyle(element).fontSize)
		);
	await page.goto('/');
	const landing = await size();
	await page.goto('/privacy');
	expect(await size()).toBeLessThan(landing);
});
