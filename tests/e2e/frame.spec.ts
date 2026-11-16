import names from '../../src/lib/i18n/names.ts';
import type { APIRequestContext, Page } from '@playwright/test';

import {
	createBase,
	createTable,
	createView,
	defaultViews,
	insertRows
} from '../../src/lib/core/actions.ts';
import { expect, seed, tablePath, test } from './harness.ts';

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

test('the panel starts at the same height on every view of a table', async ({
	page,
	context,
	account
}) => {
	void account;
	const { table, views } = await seedEveryView(context.request);
	const tops: number[] = [];
	for (const view of views) {
		await page.goto(tablePath(table, view));
		await expect(page.locator('[aria-current="page"][data-view]')).toBeVisible();
		tops.push(await panelTop(page));
	}
	expect(new Set(tops).size, `panel tops ${tops.join(', ')}`).toBe(1);
});

test('view settings open from their icon in the bar', async ({ page, context, account }) => {
	void account;
	const { table, views } = await seedEveryView(context.request);
	await page.goto(tablePath(table, views[2]));
	await page.getByRole('button', { name: 'View settings', exact: true }).click();
	const settings = page.getByRole('dialog', { name: 'View settings' });
	await expect(settings.getByLabel('Name')).toHaveValue('Log');
});
