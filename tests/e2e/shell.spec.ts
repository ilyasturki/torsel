import names from '../../src/lib/i18n/names.ts';
import type { APIRequestContext, Locator } from '@playwright/test';

import {
	createBase,
	createTable,
	defaultViews,
	createView,
	insertRows
} from '../../src/lib/core/actions.ts';
import {
	allTables,
	expect,
	expectListed,
	newView,
	openTable,
	RETRY_RESET,
	seed,
	tableList,
	tableMenu,
	tablePath,
	test
} from './harness.ts';

function seedTwoTables(request: APIRequestContext) {
	return seed(request, (ws, commit) => {
		const base = createBase(ws, 'Tables');
		commit(base.changes);
		const lifts = createTable(
			ws,
			base.id,
			'Lifts',
			[
				{ name: 'Date', type: 'date' },
				{ name: 'Reps', type: 'number' },
				{ name: 'Kg', type: 'number', step: 2.5 }
			],
			() => defaultViews(names.en)
		);
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
		const weight = createTable(ws, base.id, 'Weight', [{ name: 'Kg', type: 'number' }], () =>
			defaultViews(names.en)
		);
		commit(weight.changes);
		return { lifts: lifts.id, weight: weight.id, entry: lifts.viewIds[1], chart: chart.id };
	});
}

test('the root page is prerendered and links into the app', async ({ page }) => {
	const response = await page.goto('/');
	expect(await response?.text()).toContain('A spreadsheet you just ask.');
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
	const name = page.getByRole('textbox', { name: 'Table name' });
	await expect(name).toBeFocused();
	await name.blur();
	await expectListed(page, 'Table 1');

	await allTables(page).click();
	await expect(page.getByRole('link', { name: /Table 1/u }).first()).toBeVisible();
	await expect(page.getByRole('heading', { level: 2 })).toHaveCount(0);
});

test('the header list changes the table and the view strip changes the view', async ({
	page,
	context,
	account
}) => {
	void account;
	const { lifts } = await seedTwoTables(context.request);
	await page.goto(tablePath(lifts));
	await expect(page.getByRole('heading', { name: 'Lifts' })).toBeVisible();

	const views = page.getByRole('group', { name: 'Views' });
	await views.getByRole('link', { name: 'Entry' }).click();
	await expect(page.getByRole('button', { name: 'Add row' })).toBeVisible();
	await views.getByRole('link', { name: 'Volume' }).click();
	await expect(page).toHaveURL(new RegExp(`${tablePath('Lifts', 'Volume')}$`, 'u'));
	await expect(page.getByRole('img', { name: /per Date/u })).toBeVisible();

	await openTable(page, 'Weight');
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

test('the table list filters as it is typed in, and opens with Ctrl P', async ({
	page,
	context,
	account
}) => {
	void account;
	const { lifts } = await seed(context.request, (ws, commit) => {
		const base = createBase(ws, 'Tables');
		commit(base.changes);
		const table = createTable(ws, base.id, 'Lifts', [{ name: 'Reps', type: 'number' }], () =>
			defaultViews(names.en)
		);
		commit(table.changes);
		const rows = Array.from({ length: 40 }, (_, reps) => ({ [table.fieldIds[0]]: reps }));
		commit(insertRows(ws, table.id, rows).changes);
		for (const name of ['Body weight', 'Expenses', 'Reading list']) {
			commit(
				createTable(ws, base.id, name, [{ name: 'Value', type: 'text' }], () =>
					defaultViews(names.en)
				).changes
			);
		}
		return { lifts: table.id };
	});
	await page.goto(tablePath(lifts));
	await expect(page.locator('tbody tr').nth(39)).toBeAttached();

	const list = await tableList(page);
	await expect(list.getByRole('option', { name: 'Lifts' })).toHaveAttribute(
		'aria-selected',
		'true'
	);
	await page.getByRole('combobox', { name: 'Jump to a table' }).fill('read');
	await expect(list.getByRole('option', { name: 'Reading list' })).toHaveAttribute(
		'aria-selected',
		'true'
	);
	await expect(list.getByRole('option', { name: 'Expenses' })).toHaveCount(0);
	await page.keyboard.press('Enter');
	await expect(page.getByRole('heading', { name: 'Reading list' })).toBeVisible();
	await expect(list).toBeHidden();

	if (test.info().project.name === 'desktop') {
		await page.keyboard.press('Control+p');
		await page.keyboard.type('body');
		await page.keyboard.press('Enter');
		await expect(page.getByRole('heading', { name: 'Body weight' })).toBeVisible();
	}

	await (await tableList(page)).getByRole('option', { name: 'All tables' }).click();
	await expect(page).toHaveURL(/\/app$/u);
});

test('the assistant stays out of the way until it is opened', async ({
	page,
	context,
	account
}) => {
	void account;
	const { lifts } = await seedTwoTables(context.request);
	await page.goto(tablePath(lifts));
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

test('Escape closes the table list and leaves the Ask panel open', async ({
	page,
	context,
	account
}) => {
	test.skip(test.info().project.name === 'phone', 'on a phone the Ask panel covers the header');
	void account;
	const { lifts } = await seedTwoTables(context.request);
	await page.goto(tablePath(lifts));
	const input = page.getByPlaceholder('Ask about your tables');
	await page.getByRole('button', { name: /^Ask/u }).click();
	await expect(input).toBeVisible();

	const list = page.getByRole('listbox', { name: 'Tables' });
	await page.getByRole('banner').getByRole('heading').getByRole('button').click();
	await page.keyboard.press('Escape');
	await expect(list).toBeHidden();
	await expect(input, 'before the search takes the focus').toBeVisible();

	await tableList(page);
	await expect(page.getByRole('combobox', { name: 'Jump to a table' })).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(list).toBeHidden();
	await expect(input, 'from the search').toBeVisible();
});

test('a sheet focuses its first field and never drops a half-filled row', async ({
	page,
	context,
	account
}) => {
	void account;
	const { lifts } = await seedTwoTables(context.request);
	await page.goto(tablePath(lifts));

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
	await page.goto(tablePath(lifts));
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
	await page.goto(tablePath(lifts));

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
	expect(await gapBelow(sheet, sheet.getByRole('button', { name: 'Add row' }))).toBeGreaterThan(0);
});

test('the table menu renames the table, opens view settings and adds a view', async ({
	page,
	context,
	account
}) => {
	void account;
	const { lifts } = await seedTwoTables(context.request);
	await page.goto(tablePath(lifts));
	const dialog = page.getByRole('dialog');

	await tableMenu(page, 'Rename table');
	const name = page.getByRole('textbox', { name: 'Table name' });
	await expect(name, 'the closing menu leaves the focus in the name').toBeFocused();
	await page.keyboard.type('Sets');
	await page.keyboard.press('Enter');
	await expect(page.getByRole('heading', { name: 'Sets' })).toBeVisible();
	await expect(page.getByRole('status')).toContainText('Table renamed');

	await tableMenu(page, 'View settings');
	await expect(dialog.getByRole('heading', { name: 'View settings' })).toBeVisible();
	await page
		.getByRole('dialog', { name: 'View settings' })
		.getByRole('button', { name: 'Close' })
		.click();
	await expect(dialog).toHaveCount(0);

	await newView(page, 'List');
	await expect(
		page.getByRole('group', { name: 'Views' }).getByRole('link', { name: 'List' })
	).toBeVisible();
});

test('the table menu hangs from its button on desktop and is a sheet on a phone', async ({
	page,
	context,
	account
}) => {
	void account;
	const { lifts } = await seedTwoTables(context.request);
	await page.goto(tablePath(lifts));

	const more = page.getByRole('button', { name: 'More' });
	await more.click();
	if (test.info().project.name === 'phone') {
		await expect(page.getByRole('dialog', { name: 'Lifts' })).toBeVisible();
		await expect(page.getByRole('menu')).toHaveCount(0);
		return;
	}

	const menu = page.getByRole('menu');
	await expect(menu.getByRole('menuitem')).toHaveText([
		'View settings',
		'New view',
		'Rename table',
		'Duplicate table',
		'Fit all columns',
		'Import into this table',
		'Export as CSV',
		'Delete table'
	]);
	await expect(page.getByRole('dialog')).toHaveCount(0);
	const [button, list] = await Promise.all([more.boundingBox(), menu.boundingBox()]);
	expect(
		Math.abs((list?.x ?? 0) + (list?.width ?? 0) - (button?.x ?? 0) - (button?.width ?? 0))
	).toBeLessThan(2);
	expect(list?.y ?? 0).toBeGreaterThan(button?.y ?? 0);

	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('Enter');
	await expect(page.getByRole('menuitem', { name: 'Chart', exact: true })).toBeVisible();
	await page.keyboard.press('Escape');
	if ((await page.getByRole('menu').count()) > 0) await page.keyboard.press('Escape');
	await expect(page.getByRole('menu')).toHaveCount(0);

	await more.click();
	await expect(menu).toBeVisible();
	const again = await more.boundingBox();
	await page.mouse.click((again?.x ?? 0) + 4, (again?.y ?? 0) + 4);
	await expect(menu).toHaveCount(0);
	await expect(more).toBeFocused();
});

test('settings opens from the home and a table, and its slot turns into Back in place', async ({
	page,
	context,
	account
}) => {
	void account;
	const { lifts } = await seedTwoTables(context.request);
	const header = page.getByRole('banner');
	const ask = header.getByRole('button', { name: /^Ask/u });

	await page.goto('/app');
	const settings = header.getByRole('link', { name: 'Settings' });
	const slot = await settings.boundingBox();
	const asked = (await ask.count()) > 0 ? await ask.boundingBox() : null;
	await settings.dblclick();
	await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
	await expect(page, 'the second click does not go back').toHaveURL(/\/app\/settings$/u);
	const back = header.getByRole('link', { name: 'Back' });
	expect(await back.boundingBox(), 'Back sits where Settings was').toEqual(slot);
	if (asked !== null) expect(await ask.boundingBox(), 'nothing beside it moves').toEqual(asked);
	await expect(page.getByRole('link', { name: 'Settings' })).toHaveCount(0);
	await back.click();
	await expect(page).toHaveURL(/\/app$/u);

	await page.goto(tablePath(lifts));
	if (test.info().project.name === 'phone') {
		await page.getByRole('button', { name: 'More' }).click();
	}
	await page.getByRole('link', { name: 'Settings' }).click();
	await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
	await back.click();
	await expect(page).toHaveURL((url) => url.pathname.startsWith(tablePath('Lifts')));
});

test('undo takes back the last change, and the keyboard changes the view', async ({
	page,
	context,
	account
}) => {
	test.skip(test.info().project.name === 'phone', 'a phone has no keyboard shortcut');
	void account;
	const { lifts } = await seedTwoTables(context.request);
	await page.goto(tablePath(lifts));
	await expect(page.getByRole('heading', { name: 'Lifts' })).toBeVisible();

	await page.keyboard.press('Alt+2');
	await expect(page).toHaveURL(new RegExp(`${tablePath('Lifts', 'Entry')}$`, 'u'));

	await expect(
		page.getByRole('banner').getByRole('button', { name: /^(Undo|Redo)$/u })
	).toHaveCount(0);
	await page.getByRole('button', { name: 'Add row' }).click();
	await expect(page.getByText('2 rows')).toBeVisible();
	await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
	await expect(page.getByText('1 row', { exact: true })).toBeVisible();
});

test('every shortcut shows on the control it stands for', async ({ page, context, account }) => {
	test.skip(test.info().project.name === 'phone', 'a phone has no keyboard shortcut');
	void account;
	const { lifts } = await seedTwoTables(context.request);
	await page.goto(tablePath(lifts));
	await expect(page.getByRole('heading', { name: 'Lifts' })).toBeVisible();
	const tip = page.getByRole('tooltip').last();

	await page.getByRole('heading', { name: 'Lifts' }).getByRole('button').first().hover();
	await expect(tip).toHaveText(/Jump to a table\s*Ctrl\+P/u);
	await page.getByRole('button', { name: 'Ask', exact: true }).hover();
	await expect(tip).toHaveText('Ctrl+K');
	await expect(page.getByRole('banner')).not.toContainText('Ctrl');
	await page.getByRole('group', { name: 'Views' }).getByRole('link', { name: 'Volume' }).hover();
	await expect(tip).toHaveText('Alt+3');
	await page.getByRole('button', { name: 'More' }).hover();
	await expect(tip).toHaveText('More');

	await page.keyboard.press('Alt+2');
	await page.getByRole('button', { name: 'Add row' }).click();
	await expect(page.getByText('2 rows')).toBeVisible();
	await page.keyboard.press('Control+z');
	await page.getByRole('status').getByRole('button', { name: 'Redo' }).hover();
	await expect(tip).toHaveText('Ctrl+Shift+Z');
});

test('a number typed in a sheet stays and is saved', async ({ page, context, account }) => {
	void account;
	const { lifts } = await seedTwoTables(context.request);
	await page.goto(tablePath(lifts));

	await page.getByRole('button', { name: 'Add row' }).click();
	const reps = page.getByRole('dialog').getByLabel('Reps');
	await reps.pressSequentially('12');
	await expect(reps).toHaveValue('12');
	await page.getByRole('dialog').getByRole('button', { name: 'Add row' }).click();

	await expect(page.getByRole('gridcell', { name: '12', exact: true })).toBeVisible();
});

test('focus comes back where the keyboard left it', async ({ page, context, account }) => {
	test.skip(test.info().project.name === 'phone', 'a phone has no keyboard focus to keep');
	void account;
	const { lifts } = await seedTwoTables(context.request);
	await page.goto(tablePath(lifts));
	const grid = page.getByRole('grid');
	await page.getByRole('gridcell', { name: '8', exact: true }).click();
	await expect(grid).toBeFocused();

	await page.keyboard.press('Control+p');
	await expect(page.getByRole('combobox', { name: 'Jump to a table' })).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(grid).toBeFocused();

	await tableMenu(page, 'Rename table');
	await page.getByRole('textbox', { name: 'Table name' }).fill('Gym');
	await page.keyboard.press('Enter');
	await expect(page.getByRole('heading', { name: 'Gym' }).getByRole('button')).toBeFocused();
	await expect(page.getByRole('combobox', { name: 'Jump to a table' })).toHaveCount(0);

	const undo = page.getByRole('status').getByRole('button', { name: 'Undo' });
	await undo.focus();
	await page.keyboard.press('Enter');
	await expect(page.getByRole('status').getByRole('button', { name: 'Redo' })).toBeFocused();
	await expect(page.getByRole('heading', { name: 'Lifts' })).toBeVisible();
});

test('entry steps a value and adds the row', async ({ page, context, account }) => {
	void account;
	const { lifts, entry } = await seedTwoTables(context.request);
	await page.clock.install();
	await page.goto(tablePath(lifts, entry));

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
		const sets = createTable(
			ws,
			base.id,
			'Sets',
			[
				{ name: 'Date', type: 'date' },
				{
					name: 'Exercise',
					type: 'choice',
					choices: [
						'Squat',
						'Bench',
						'Dip',
						...Array.from({ length: 10 }, (_, i) => `Lift ${i}`)
					].map((name) => ({ name, color: null }))
				},
				{ name: 'Kg', type: 'number' },
				{ name: 'Reps', type: 'number' }
			],
			() => defaultViews(names.en)
		);
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
				row('2026-10-19', 'Bench', 67.5, 8),
				row('2026-10-20', 'Squat', 100, 5),
				row('2026-10-21', 'Bench', 70, 8),
				row('2026-10-22', 'Squat', 102.5, 5),
				row('2026-10-24', 'Bench', null, null),
				row('2026-10-24', 'Squat', null, null),
				row('2026-10-24', 'Dip', null, null)
			]).changes
		);
		return { path: tablePath(sets.id, sets.viewIds[1]) };
	});
	await page.goto(path);

	const source = page.getByText(/^From /u);
	const chips = page.getByRole('button', { pressed: true }).locator('..').getByRole('button');
	await expect(chips.first(), 'what was done comes before what was only planned').toHaveText(
		'Squat'
	);
	await expect(page.getByRole('button', { name: 'Squat', pressed: true })).toBeVisible();
	await expect(source).toHaveText('From Oct 22');
	await expect(page.getByRole('textbox', { name: 'Kg' })).toHaveValue('102.5');
	await expect(page.getByRole('textbox', { name: 'Reps' })).toHaveValue('5');

	await page.getByRole('textbox', { name: 'Reps' }).fill('6');
	await page.getByRole('button', { name: 'Bench', exact: true }).click();
	await expect(source).toHaveText('From Oct 21');
	await expect(page.getByRole('textbox', { name: 'Kg' })).toHaveValue('70');
	await expect(page.getByRole('textbox', { name: 'Reps' }), 'what was typed stays').toHaveValue(
		'6'
	);

	await source.getByRole('button').click();
	await expect(page.getByRole('dialog').getByLabel('Kg')).toHaveValue('70');
});

test.describe('in another locale', () => {
	test.use({ locale: 'de-DE' });

	test('numbers and dates follow the browser', async ({ page, context, account }) => {
		void account;
		const { lifts } = await seedTwoTables(context.request);
		await page.goto(tablePath(lifts));
		await expect(page.getByRole('gridcell', { name: '1234,5', exact: true })).toBeVisible();
		await expect(page.getByRole('gridcell', { name: /30\. Okt/u })).toBeVisible();
	});
});
