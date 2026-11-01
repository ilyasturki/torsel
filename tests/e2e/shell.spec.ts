import type { APIRequestContext, Locator } from '@playwright/test';

import { createBase, createTable, createView, insertRows } from '../../src/lib/core/actions.ts';
import { expect, RETRY_RESET, seed, test } from './harness.ts';

function seedTwoTables(request: APIRequestContext) {
	return seed(request, (ws, commit) => {
		const base = createBase(ws, 'Tables');
		commit(base.changes);
		const lifts = createTable(ws, base.id, 'Lifts', [
			{ name: 'Date', type: 'date' },
			{ name: 'Reps', type: 'number' },
			{ name: 'Kg', type: 'number', step: 2.5 }
		]);
		commit(lifts.changes);
		commit(
			insertRows(ws, lifts.id, [
				{ [lifts.fieldIds[0]]: '2026-10-30', [lifts.fieldIds[1]]: 8, [lifts.fieldIds[2]]: 1234.5 }
			]).changes
		);
		const chart = createView(ws, lifts.id, {
			name: 'Volume',
			type: 'chart',
			config: { kind: 'bar', x: lifts.fieldIds[0], agg: 'sum', y: lifts.fieldIds[2] }
		});
		commit(chart.changes);
		const weight = createTable(ws, base.id, 'Weight', [{ name: 'Kg', type: 'number' }]);
		commit(weight.changes);
		return { lifts: lifts.id, weight: weight.id, entry: lifts.viewIds[1], chart: chart.id };
	});
}

test('the root page is prerendered and links into the app', async ({ page }) => {
	const response = await page.goto('/');
	expect(await response?.text()).toContain('Say what you want to track.');
	await expect(
		page.getByRole('main').getByRole('link', { name: 'Start now' }).first()
	).toHaveAttribute('href', '/app');
});

test('the app shows the logo and serves its manifest and icons', async ({
	page,
	context,
	account
}) => {
	void account;
	await page.goto('/app');
	await expect(page.getByRole('img', { name: 'Torsel' }).locator('visible=true')).toHaveCount(1);

	for (const rel of ['manifest', 'apple-touch-icon']) {
		const href = await page.locator(`link[rel="${rel}"]`).getAttribute('href');
		const response = await context.request.get(href ?? '', RETRY_RESET);
		expect(response.status(), rel).toBe(200);
	}

	const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
	const manifest = await (await context.request.get(manifestHref ?? '', RETRY_RESET)).json();
	await page.goto(manifest.start_url);
	await expect(page.getByRole('heading', { name: 'Tables' })).toBeVisible();
});

test('a first table takes one click, with no base to name', async ({ page, account }) => {
	void account;
	await page.goto('/app');
	await expect(page.getByText('No tables yet.')).toBeVisible();

	await page.getByRole('button', { name: 'New table' }).first().click();

	await expect(page).toHaveURL(/\/app\/t\//u);
	await expect(page.getByRole('heading', { name: 'Table 1' })).toBeVisible();
	const tabs = page.getByRole('group', { name: 'Tables' });
	const name = page.getByRole('textbox', { name: 'Table name' });
	await expect(name).toBeFocused();
	if (test.info().project.name === 'phone') {
		await expect(tabs, 'the tabs make way for the keyboard').toBeHidden();
	}
	await name.blur();
	await expect(tabs.getByRole('link', { name: 'Table 1' })).toHaveAttribute('aria-current', 'page');

	await tabs.getByRole('link', { name: 'All' }).click();
	await expect(page.getByRole('link', { name: /Table 1/u }).first()).toBeVisible();
	await expect(page.getByRole('heading', { level: 2 })).toHaveCount(0);
});

test('tabs change the table and the view strip changes the view', async ({
	page,
	context,
	account
}) => {
	void account;
	const { lifts, chart } = await seedTwoTables(context.request);
	await page.goto(`/app/t/${lifts}`);
	await expect(page.getByRole('heading', { name: 'Lifts' })).toBeVisible();

	const views = page.getByRole('group', { name: 'Views' });
	await views.getByRole('link', { name: 'Entry' }).click();
	await expect(page.getByRole('button', { name: 'Add row' })).toBeVisible();
	await views.getByRole('link', { name: 'Volume' }).click();
	await expect(page).toHaveURL(new RegExp(`v=${chart}`, 'u'));
	await expect(page.getByRole('img', { name: /per Date/u })).toBeVisible();

	await page.getByRole('group', { name: 'Tables' }).getByRole('link', { name: 'Weight' }).click();
	await expect(page.getByRole('heading', { name: 'Weight' })).toBeVisible();
	await expect(page.getByText('0 rows')).toBeVisible();
});

test('bases group the home only once there is more than one', async ({
	page,
	context,
	account
}) => {
	void account;
	await seedTwoTables(context.request);
	await page.goto('/app');
	await expect(page.getByRole('link', { name: /Lifts/u }).first()).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Tables', level: 2 })).toHaveCount(0);

	await page.getByRole('button', { name: 'New base' }).click();
	await page.getByRole('textbox', { name: 'New base' }).fill('Money');
	await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();

	await expect(page.getByRole('heading', { name: 'Tables', level: 2 })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Money', level: 2 })).toBeVisible();
});

test('the floating tabs stay above a long table', async ({ page, context, account }) => {
	void account;
	const { lifts } = await seed(context.request, (ws, commit) => {
		const base = createBase(ws, 'Tables');
		commit(base.changes);
		const table = createTable(ws, base.id, 'Lifts', [{ name: 'Reps', type: 'number' }]);
		commit(table.changes);
		const rows = Array.from({ length: 40 }, (_, reps) => ({ [table.fieldIds[0]]: reps }));
		commit(insertRows(ws, table.id, rows).changes);
		for (const name of ['Body weight', 'Expenses', 'Reading list']) {
			commit(createTable(ws, base.id, name, [{ name: 'Value', type: 'text' }]).changes);
		}
		return { lifts: table.id };
	});
	await page.goto(`/app/t/${lifts}`);
	await expect(page.locator('tbody tr').nth(39)).toBeAttached();

	await page.getByRole('group', { name: 'Tables' }).getByRole('link', { name: 'All' }).click();
	await expect(page).toHaveURL(/\/app$/u);
});

test('the assistant stays out of the way until it is opened', async ({
	page,
	context,
	account
}) => {
	void account;
	const { lifts } = await seedTwoTables(context.request);
	await page.goto(`/app/t/${lifts}`);
	await expect(page.getByRole('heading', { name: 'Lifts' })).toBeVisible();

	const input = page.getByPlaceholder('Ask about your tables');
	await expect(input).toBeHidden();

	await page.getByRole('button', { name: /^Ask/u }).click();
	await expect(input).toBeVisible();
	await expect(input).toBeFocused();
	await expect(page.getByText('On Lifts, Grid')).toBeVisible();

	await page.keyboard.press('Escape');
	await expect(input).toBeHidden();

	await page.keyboard.press('Control+k');
	await expect(input).toBeVisible();
});

test('a sheet focuses its first field and never drops a half-filled row', async ({
	page,
	context,
	account
}) => {
	void account;
	const { lifts } = await seedTwoTables(context.request);
	await page.goto(`/app/t/${lifts}`);

	await page.getByRole('button', { name: 'Add row' }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByLabel('Date')).toBeFocused();

	await page.keyboard.press('Escape');
	await expect(dialog).toHaveCount(0);

	await page.getByRole('button', { name: 'Add row' }).click();
	await dialog.getByLabel('Reps').fill('12');

	await page.keyboard.press('Escape');
	await expect(dialog.getByText('Discard your changes?')).toBeVisible();
	await page.getByRole('button', { name: 'Keep editing' }).click();
	await expect(dialog.getByLabel('Reps')).toHaveValue('12');

	await page.mouse.click(2, 2);
	await expect(dialog.getByText('Discard your changes?')).toBeVisible();
	await expect(dialog.getByLabel('Reps')).toHaveValue('12');

	await page.getByRole('button', { name: 'Discard' }).click();
	await expect(dialog).toHaveCount(0);
});

test('the closed assistant gives the shell no room to slide sideways', async ({
	page,
	context,
	account
}) => {
	void account;
	const { lifts } = await seedTwoTables(context.request);
	await page.goto(`/app/t/${lifts}`);
	const heading = page.getByRole('heading', { name: 'Lifts' });
	await expect(heading).toBeVisible();
	const before = await heading.boundingBox();

	await page
		.locator('aside[aria-label="Ask"]')
		.evaluate((panel) => panel.scrollIntoView({ inline: 'end' }));

	expect(await heading.boundingBox()).toEqual(before);
});

test('a sheet and the assistant keep room under their buttons', async ({
	page,
	context,
	account
}) => {
	void account;
	const { lifts } = await seedTwoTables(context.request);
	await page.goto(`/app/t/${lifts}`);

	const gapBelow = async (outer: Locator, inner: Locator): Promise<number> => {
		await expect(inner).toBeVisible();
		const [outerBox, innerBox] = await Promise.all([outer.boundingBox(), inner.boundingBox()]);
		return (
			(outerBox?.y ?? 0) + (outerBox?.height ?? 0) - (innerBox?.y ?? 0) - (innerBox?.height ?? 0)
		);
	};

	await page.getByRole('button', { name: /^Ask/u }).click();
	const composer = page
		.locator('form')
		.filter({ has: page.getByPlaceholder('Ask about your tables') });
	expect(await gapBelow(composer, composer.getByRole('button', { name: 'Send' }))).toBeGreaterThan(
		0
	);
	await page.keyboard.press('Escape');

	await page.getByRole('button', { name: 'Add row' }).click();
	const sheet = page.getByRole('dialog');
	expect(await gapBelow(sheet, sheet.getByRole('button', { name: 'Save' }))).toBeGreaterThan(0);
});

test('the title renames the table, and the table menu opens view settings and adds a view', async ({
	page,
	context,
	account
}) => {
	void account;
	const { lifts } = await seedTwoTables(context.request);
	await page.goto(`/app/t/${lifts}`);
	const dialog = page.getByRole('dialog');

	await page.getByRole('heading', { name: 'Lifts' }).getByRole('button').click();
	await page.getByRole('textbox', { name: 'Table name' }).fill('Sets');
	await page.keyboard.press('Enter');
	await expect(page.getByRole('heading', { name: 'Sets' })).toBeVisible();

	await page.getByRole('button', { name: 'More' }).click();
	await dialog.getByRole('button', { name: 'View settings' }).click();
	await expect(dialog.getByRole('heading', { name: 'View settings' })).toBeVisible();
	await page
		.getByRole('dialog', { name: 'View settings' })
		.getByRole('button', { name: 'Close' })
		.click();
	await expect(dialog).toHaveCount(0);

	await page.getByRole('button', { name: 'More' }).click();
	await dialog.getByRole('button', { name: 'New view' }).click();
	await dialog.getByRole('button', { name: /^List/u }).click();
	await dialog.getByRole('button', { name: 'Create' }).click();
	await expect(
		page.getByRole('group', { name: 'Views' }).getByRole('link', { name: 'List' })
	).toBeVisible();
});

test('settings can be reached from the home and from a table', async ({
	page,
	context,
	account
}) => {
	void account;
	const { lifts } = await seedTwoTables(context.request);

	await page.goto('/app');
	await page.getByRole('link', { name: 'Settings' }).click();
	await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

	await page.goto(`/app/t/${lifts}`);
	const more = page.getByRole('button', { name: 'More' });
	if (test.info().project.name === 'phone') {
		await more.click();
	}
	await page.getByRole('link', { name: 'Settings' }).click();
	await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
});

test('undo takes back the last change, and the keyboard changes the view', async ({
	page,
	context,
	account
}) => {
	test.skip(test.info().project.name === 'phone', 'a phone has no keyboard shortcut');
	void account;
	const { lifts, entry } = await seedTwoTables(context.request);
	await page.goto(`/app/t/${lifts}`);
	await expect(page.getByRole('heading', { name: 'Lifts' })).toBeVisible();

	await page.keyboard.press('Alt+2');
	await expect(page).toHaveURL(new RegExp(`v=${entry}`, 'u'));

	await page.getByRole('button', { name: 'Add row' }).click();
	await expect(page.getByText('2 rows')).toBeVisible();
	await page.getByRole('button', { name: 'Undo', exact: true }).first().click();
	await expect(page.getByText('1 row', { exact: true })).toBeVisible();
});

test('a number typed in a sheet stays and is saved', async ({ page, context, account }) => {
	void account;
	const { lifts } = await seedTwoTables(context.request);
	await page.goto(`/app/t/${lifts}`);

	await page.getByRole('button', { name: 'Add row' }).click();
	const reps = page.getByRole('dialog').getByLabel('Reps');
	await reps.pressSequentially('12');
	await expect(reps).toHaveValue('12');
	await page.getByRole('button', { name: 'Save' }).click();

	await expect(page.getByRole('gridcell', { name: '12', exact: true })).toBeVisible();
});

test('entry steps a value and adds the row', async ({ page, context, account }) => {
	void account;
	const { lifts, entry } = await seedTwoTables(context.request);
	await page.clock.install();
	await page.goto(`/app/t/${lifts}?v=${entry}`);

	await page.getByRole('button', { name: 'Reps plus' }).click();
	await expect(page.getByRole('textbox', { name: 'Reps' })).toHaveValue('9');
	// The toast lasts 6s, which a loaded machine can spend before the assertions below run.
	await page.clock.pauseAt(Date.now() + 1000);
	await page.getByRole('button', { name: 'Add row' }).click();

	await expect(page.getByText('2 rows')).toBeVisible();
	await expect(page.getByRole('status')).toContainText('Row added');
	const free = await page.getByRole('button', { name: 'Add row' }).evaluate((button) => {
		const { left, top, width, height } = button.getBoundingClientRect();
		return button.contains(document.elementFromPoint(left + width / 2, top + height / 2));
	});
	expect(free, 'the toast leaves Add row free for the next set').toBe(true);

	await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
	await expect(page.getByText('1 row', { exact: true })).toBeVisible();
});

test('entry fills in from the last row done, past rows planned and left blank', async ({
	page,
	context,
	account
}) => {
	void account;
	const { path } = await seed(context.request, (ws, commit) => {
		const base = createBase(ws, 'Gym');
		commit(base.changes);
		const sets = createTable(ws, base.id, 'Sets', [
			{ name: 'Date', type: 'date' },
			{
				name: 'Exercise',
				type: 'choice',
				choices: [
					{ name: 'Squat', color: null },
					{ name: 'Bench', color: null }
				]
			},
			{ name: 'Kg', type: 'number' },
			{ name: 'Reps', type: 'number' }
		]);
		commit(sets.changes);
		const [date, exercise, kg, reps] = sets.fieldIds;
		const row = (day: string, name: string, load: number | null, count: number | null) => ({
			[date]: day,
			[exercise]: name,
			[kg]: load,
			[reps]: count
		});
		commit(
			insertRows(ws, sets.id, [
				row('2026-10-20', 'Squat', 100, 5),
				row('2026-10-21', 'Bench', 70, 8),
				row('2026-10-22', 'Squat', 102.5, 5),
				row('2026-10-24', 'Bench', null, null),
				row('2026-10-24', 'Squat', null, null)
			]).changes
		);
		return { path: `/app/t/${sets.id}?v=${sets.viewIds[1]}` };
	});
	await page.goto(path);

	const lastTime = page.locator('p').filter({ hasText: /^Last time/u });
	await expect(page.getByRole('button', { name: 'Squat', pressed: true })).toBeVisible();
	await expect(lastTime).toContainText('Oct 22');
	await expect(lastTime).toContainText('102.5 · 5');
	await expect(page.getByRole('textbox', { name: 'Kg' })).toHaveValue('102.5');

	await page.getByRole('button', { name: 'Bench', exact: true }).click();
	await expect(lastTime).toContainText('70 · 8');
	await expect(page.getByRole('textbox', { name: 'Reps' })).toHaveValue('8');
});

test.describe('in another locale', () => {
	test.use({ locale: 'de-DE' });

	test('numbers and dates follow the browser', async ({ page, context, account }) => {
		void account;
		const { lifts } = await seedTwoTables(context.request);
		await page.goto(`/app/t/${lifts}`);
		await expect(page.getByRole('gridcell', { name: '1.234,5' })).toBeVisible();
		await expect(page.getByRole('gridcell', { name: /30\. Okt/u })).toBeVisible();
	});
});
