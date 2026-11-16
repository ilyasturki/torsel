import names from '../../src/lib/i18n/names.ts';
import viewWords from '../../src/lib/i18n/views.ts';
import type { APIRequestContext, Locator, Page } from '@playwright/test';

import {
	createBase,
	createTable,
	defaultViews,
	createView,
	insertRows
} from '../../src/lib/core/actions.ts';
import { expect, newView, seed, tableMenu, tablePath, test, undo } from './harness.ts';

const onPhone = (): boolean => test.info().project.name === 'phone';

function seedWeighIns(request: APIRequestContext) {
	return seed(request, (ws, commit) => {
		const base = createBase(ws, 'Body');
		commit(base.changes);
		const weights = createTable(
			ws,
			base.id,
			'Weigh-ins',
			[
				{ name: 'Day', type: 'date' },
				{ name: 'Kg', type: 'number' }
			],
			() => defaultViews(names.en)
		);
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
		const name = viewWords.fr.chartName(viewWords.fr.chartValue.avg('kg'), 'Day');
		const chart = page.getByRole('img', { name });
		await expect(chart).toContainText('26 oct.');
		await expect(chart).toContainText(/10\s088/u);

		await pointAt(page, chart, 0.03);
		await expect(page.getByTestId('chart-readout')).toContainText(/10\s088,4/u);
	});

	test('a chart reads its settings as a French sentence', async ({ page, context, account }) => {
		void account;
		await page.goto(await seedWeighIns(context.request));
		await expect(page.getByTestId('chart-line')).toHaveText(
			/^Moyenne\s*de\s*Kg\s*par\s*Day\s*par\s*jour$/u
		);
	});
});

test('a new chart starts from a guess, and its sentence sets it as it is picked', async ({
	page,
	context,
	account
}) => {
	void account;
	await page.goto(await seedWeighIns(context.request));
	await newView(page, 'Chart');
	const chart = page.getByRole('img', { name: 'Average kg per Day' });
	await expect(chart.locator('polyline')).toHaveCount(1);
	await expect(page.getByTestId('chart-line')).toHaveText(
		/Average\s*of\s*Kg\s*by\s*Day\s*per\s*day/u
	);

	if (onPhone()) {
		await expect(page.getByRole('dialog')).toHaveCount(0);
	} else {
		await expect(page.getByRole('menuitem', { name: 'Average' })).toBeVisible();
		await page.keyboard.press('Escape');
	}

	await page
		.getByRole('group', { name: 'Chart kind' })
		.getByRole('button', { name: 'Bars' })
		.click();
	await expect(chart.locator('polyline')).toHaveCount(0);
	await expect(page.getByRole('status')).toContainText('View "Chart" changed');
	await undo(page);
	await expect(chart.locator('polyline')).toHaveCount(1);

	await page.getByRole('button', { name: 'Calculation: Average' }).click();
	await (
		onPhone()
			? page.getByRole('option', { name: 'Row count' })
			: page.getByRole('menuitem', { name: 'Row count' })
	).click();
	await expect(page.getByRole('img', { name: 'Row count per Day' })).toBeVisible();
	await expect(page.getByTestId('chart-line')).toHaveText(/^Row count\s*by\s*Day\s*per\s*day$/u);
});
