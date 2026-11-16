import names from '../../src/lib/i18n/names.ts';
import type { APIRequestContext, Locator, Page } from '@playwright/test';

import {
	createBase,
	createTable,
	defaultViews,
	createView,
	insertRows
} from '../../src/lib/core/actions.ts';
import { expect, seed, tablePath, test } from './harness.ts';

const onPhone = (): boolean => test.info().project.name === 'phone';
const press = (target: Locator): Promise<void> => (onPhone() ? target.tap() : target.click());

/** Two sessions, push on Oct 30 and legs on Oct 31, logged in an Entry keyed by session then exercise. */
function seedSessions(request: APIRequestContext, keys: 'two' | 'one' | 'none' = 'two') {
	return seed(request, (ws, commit) => {
		const base = createBase(ws, 'Gym');
		commit(base.changes);
		const choices = (names: string[]) => names.map((name) => ({ name, color: null }));
		const sets = createTable(
			ws,
			base.id,
			'Sets',
			[
				{ name: 'Session', type: 'choice', choices: choices(['push', 'legs']) },
				{ name: 'Date', type: 'date' },
				{ name: 'Exercise', type: 'choice', choices: choices(['bench', 'dips', 'squat']) },
				{ name: 'Reps', type: 'number' },
				{ name: 'Kg', type: 'number', step: 2.5 }
			],
			() => defaultViews(names.en)
		);
		commit(sets.changes);
		const [session, date, exercise, reps, kg] = sets.fieldIds;
		const set = (day: string, name: string, lift: string, count: number, load: number) => ({
			[session]: name,
			[date]: day,
			[exercise]: lift,
			[reps]: count,
			[kg]: load
		});
		commit(
			insertRows(ws, sets.id, [
				set('2026-10-30', 'push', 'bench', 8, 60),
				set('2026-10-30', 'push', 'bench', 6, 65),
				set('2026-10-30', 'push', 'dips', 10, 0),
				set('2026-10-31', 'legs', 'squat', 5, 100),
				...(keys === 'none'
					? [set('2026-10-28', 'legs', 'squat', 5, 95), set('2026-10-28', 'legs', 'squat', 5, 95)]
					: [])
			]).changes
		);
		const entry = createView(ws, sets.id, {
			name: 'Log',
			type: 'entry',
			config: keys === 'none' ? {} : { match: keys === 'one' ? [exercise] : [session, exercise] }
		});
		commit(entry.changes);
		return tablePath(sets.id, entry.id);
	});
}

const plan = (page: Page): Locator => page.getByRole('group', { name: 'Last time' });

test('with one key, the rows on the left sit at the top under heads and a line naming the filter', async ({
	page,
	context,
	account
}) => {
	void account;
	await page.goto(await seedSessions(context.request, 'one'));
	const history = plan(page);
	const filter = page.getByTestId('entry-filter');

	await expect(filter).toContainText('Exercise');
	await expect(filter).toContainText('squat');
	await press(page.getByRole('button', { name: 'bench', exact: true }));
	await expect(filter).toContainText('bench');

	const rows = history.getByRole('listitem');
	await expect(rows).toHaveCount(2);
	for (const head of ['Date', 'Reps', 'Kg']) {
		await expect(history.getByText(head, { exact: true })).toBeVisible();
	}
	await expect(rows.first()).toContainText('Oct 30');

	const top = (await history.boundingBox())?.y ?? 0;
	const first = (await rows.first().boundingBox())?.y ?? 0;
	expect(first - top, 'the first row sits under the filter line and the heads').toBeLessThan(120);
});

test('a log of sessions opens in the plan by itself', async ({ page, context, account }) => {
	void account;
	await page.goto(await seedSessions(context.request, 'none'));
	await expect(page.getByRole('button', { name: 'legs', pressed: true })).toBeVisible();
	await expect(plan(page).getByRole('button', { pressed: true })).toContainText('5');
	await expect(page.getByTestId('entry-filter')).toHaveCount(0);
});

test('Entry repeats the last session, set by set, and moves to the next', async ({
	page,
	context,
	account
}) => {
	void account;
	await page.goto(await seedSessions(context.request));
	const reps = page.getByRole('textbox', { name: 'Reps' });
	const kg = page.getByRole('textbox', { name: 'Kg' });
	const addRow = page.getByRole('button', { name: 'Add row' });

	await expect(page.getByRole('button', { name: 'legs', pressed: true })).toBeVisible();
	await expect(plan(page).getByRole('button', { pressed: true })).toContainText('5');
	await press(page.getByRole('button', { name: 'push', exact: true }));

	const lines = plan(page).getByRole('button', { name: /^(Logged )?\d/u });
	await expect(lines).toHaveCount(3);
	await expect(lines.nth(0)).toHaveAttribute('aria-pressed', 'true');
	await expect(reps).toHaveValue('8');
	await expect(kg).toHaveValue('60');
	await expect(page.getByText('Oct 30').last()).toBeVisible();

	await press(addRow);
	await expect(page.getByText('5 rows')).toBeVisible();
	await expect(lines.nth(0)).toHaveAccessibleName(/^Logged/u);
	await expect(lines.nth(1)).toHaveAttribute('aria-pressed', 'true');
	await expect(reps).toHaveValue('6');
	await expect(kg).toHaveValue('65');

	await press(page.getByRole('button', { name: 'Kg plus' }));
	await expect(kg).toHaveValue('67.5');
	await press(addRow);
	await expect(page.getByText('6 rows')).toBeVisible();
	await expect(lines.nth(1)).toContainText('67.5');
	await expect(lines.nth(2)).toHaveAttribute('aria-pressed', 'true');
	await expect(reps).toHaveValue('10');

	await press(addRow);
	await expect(page.getByText('7 rows')).toBeVisible();
	await expect(plan(page).getByRole('button', { name: 'Pick another Exercise' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'dips', pressed: true })).toBeVisible();
	await expect(page.getByText(/^From /u)).toHaveText('From today');
	await expect(reps).toHaveValue('10');

	if (!onPhone()) {
		await expect(lines.nth(1)).toContainText(/65.*67\.5/u);
	}
});

test('a planned line can be logged out of turn, and another exercise added', async ({
	page,
	context,
	account
}) => {
	void account;
	await page.goto(await seedSessions(context.request));
	await press(page.getByRole('button', { name: 'push', exact: true }));
	const lines = plan(page).getByRole('button', { name: /^(Logged )?\d/u });

	await press(lines.nth(2));
	await expect(lines.nth(2)).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByRole('textbox', { name: 'Reps' })).toHaveValue('10');
	await press(page.getByRole('button', { name: 'Add row' }));
	await expect(lines.nth(0)).toHaveAttribute('aria-pressed', 'true');

	await press(plan(page).getByRole('button', { name: 'Pick another Exercise' }));
	await press(page.getByRole('button', { name: 'squat', exact: true }));
	await expect(page.getByRole('textbox', { name: 'Kg' })).toHaveValue('');
	await page.getByRole('textbox', { name: 'Kg' }).fill('40');
	await press(page.getByRole('button', { name: 'Add row' }));
	await expect(page.getByText('6 rows')).toBeVisible();
	await expect(plan(page)).toContainText('squat');
	await expect(plan(page).getByRole('button', { name: /^Logged/u })).toHaveCount(2);
});

test('a double click on Add row logs one row, and the desktop button is mouse-sized', async ({
	page,
	context,
	account
}) => {
	void account;
	const path = await seed(context.request, (ws, commit) => {
		const base = createBase(ws, 'Body');
		commit(base.changes);
		const weight = createTable(
			ws,
			base.id,
			'Weight',
			[
				{ name: 'Date', type: 'date' },
				{ name: 'Kg', type: 'number' }
			],
			() => defaultViews(names.en)
		);
		commit(weight.changes);
		commit(insertRows(ws, weight.id, [{ [weight.fieldIds[1]]: 80 }]).changes);
		const entry = createView(ws, weight.id, { name: 'Log', type: 'entry', config: {} });
		commit(entry.changes);
		return tablePath(weight.id, entry.id);
	});
	await page.goto(path);
	const addRow = page.getByRole('button', { name: 'Add row' });
	await expect(page.getByText('1 row', { exact: true })).toBeVisible();

	await addRow.click({ clickCount: 2 });
	await expect(page.getByText('2 rows')).toBeVisible();
	await page.waitForTimeout(600);
	await expect(page.getByText('2 rows')).toBeVisible();
	await addRow.click();
	await expect(page.getByText('3 rows')).toBeVisible();

	const more = await page.getByRole('button', { name: 'More' }).boundingBox();
	const height = (await addRow.boundingBox())?.height;
	if (onPhone()) expect(height).toBeGreaterThan(more?.height ?? 0);
	else expect(height).toBe(more?.height);
});
