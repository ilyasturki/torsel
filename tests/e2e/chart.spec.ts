import type { APIRequestContext, Locator, Page } from '@playwright/test';

import { createBase, createTable, createView, insertRows } from '../../src/lib/core/actions.ts';
import { expect, seed, tablePath, test } from './harness.ts';

const onPhone = (): boolean => test.info().project.name === 'phone';

function seedWeighIns(request: APIRequestContext) {
	return seed(request, (ws, commit) => {
		const base = createBase(ws, 'Body');
		commit(base.changes);
		const weights = createTable(ws, base.id, 'Weigh-ins', [
			{ name: 'Day', type: 'date' },
			{ name: 'Kg', type: 'number' }
		]);
		commit(weights.changes);
		const [day, kg] = weights.fieldIds;
		commit(
			insertRows(ws, weights.id, [
				{ [day]: '2026-10-26', [kg]: 10088.4 },
				{ [day]: '2026-10-27', [kg]: 10087.9 },
				{ [day]: '2026-10-28', [kg]: 10088.1 }
			]).changes
		);
		const trend = createView(ws, weights.id, {
			name: 'Trend',
			type: 'chart',
			config: { kind: 'line', x: day, agg: 'avg', y: kg }
		});
		commit(trend.changes);
		return tablePath(weights.id, trend.id);
	});
}

/** Points at the chart a fraction of the way across its plot, by mouse or by finger. */
async function pointAt(page: Page, chart: Locator, across: number): Promise<void> {
	const box = await chart.boundingBox();
	if (box === null) throw new Error('no chart');
	const x = box.x + box.width * across;
	const y = box.y + box.height / 2;
	if (onPhone()) await page.touchscreen.tap(x, y);
	else await page.mouse.move(x, y);
}

test('a chart reads out the value under the pointer, and from the keyboard', async ({
	page,
	context,
	account
}) => {
	void account;
	await page.goto(await seedWeighIns(context.request));
	const chart = page.getByRole('img', { name: 'Average kg per Day' });
	const readout = page.getByTestId('chart-readout');
	await expect(chart).toBeVisible();
	await expect(chart).toContainText('10,088');
	await expect(chart).toContainText('Oct 26');

	await pointAt(page, chart, 0.97);
	await expect(readout).toContainText('Oct 28');
	await expect(readout).toContainText('10,088.1');

	await chart.focus();
	await page.keyboard.press('ArrowLeft');
	await expect(readout).toContainText('Oct 27');
	await expect(readout).toContainText('10,087.9');
	await page.keyboard.press('Escape');
	await expect(readout).toHaveCount(0);
});

test.describe('in French', () => {
	test.use({ locale: 'fr-FR' });

	test("a chart's axes and readout use the locale's own forms", async ({
		page,
		context,
		account
	}) => {
		void account;
		await page.goto(await seedWeighIns(context.request));
		const chart = page.getByRole('img', { name: 'Average kg per Day' });
		await expect(chart).toContainText('26 oct.');
		await expect(chart).toContainText(/10\s088/u);

		await pointAt(page, chart, 0.03);
		await expect(page.getByTestId('chart-readout')).toContainText(/10\s088,4/u);
	});
});
