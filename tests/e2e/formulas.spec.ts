import names from '../../src/lib/i18n/names.ts';
import type { APIRequestContext, Locator, Page } from '@playwright/test';

import {
	addField,
	createBase,
	createTable,
	defaultViews,
	insertRows
} from '../../src/lib/core/actions.ts';
import { expect, openTable, seed, tablePath, test } from './harness.ts';

const isPhone = (): boolean => test.info().project.name === 'phone';

/** Exercises (Name, Muscle) and Sets (Exercise linking to it, Kg, Check, a formula still to write). */
function seedGym(request: APIRequestContext) {
	return seed(request, (ws, commit) => {
		const base = createBase(ws, 'Gym');
		commit(base.changes);
		const exercises = createTable(
			ws,
			base.id,
			'Exercises',
			[
				{ name: 'Name', type: 'text' },
				{ name: 'Muscle', type: 'text' }
			],
			() => defaultViews(names.en)
		);
		commit(exercises.changes);
		const [name, muscle] = exercises.fieldIds;
		const rows = insertRows(ws, exercises.id, [
			{ [name]: 'Bench', [muscle]: 'chest' },
			{ [name]: 'Squat', [muscle]: 'legs' }
		]);
		commit(rows.changes);
		const total = addField(ws, exercises.id, { name: 'Total', type: 'formula', expr: '0' });
		commit(total.changes);

		const sets = createTable(
			ws,
			base.id,
			'Sets',
			[
				{ name: 'Exercise', type: 'link', target: exercises.id },
				{ name: 'Kg', type: 'number' }
			],
			() => defaultViews(names.en)
		);
		commit(sets.changes);
		const [link, kg] = sets.fieldIds;
		commit(
			insertRows(ws, sets.id, [
				{ [link]: rows.ids[0], [kg]: 80 },
				{ [link]: rows.ids[0], [kg]: 85 },
				{ [link]: rows.ids[1], [kg]: 100 }
			]).changes
		);
		const looked = addField(ws, sets.id, { name: 'Muscle', type: 'formula', expr: '0' });
		commit(looked.changes);
		return { sets: tablePath(sets.id), exercises: tablePath(exercises.id) };
	});
}

const at = (page: Page, row: number, col: number): Locator =>
	page.locator(`#grid-cell-${row}-${col}`);

async function open(page: Page, path: string): Promise<void> {
	await page.goto(path);
	await expect(page.getByRole('grid')).toBeVisible();
}

async function edit(cell: Locator): Promise<void> {
	await cell.scrollIntoViewIfNeeded();
	if (isPhone()) await cell.tap();
	else await cell.dblclick();
}

async function choose(formula: Locator, page: Page, typed: string, option: string): Promise<void> {
	await formula.pressSequentially(typed);
	await expect(page.getByRole('option', { name: option, exact: true })).toBeVisible();
	await formula.press('Enter');
}

test.describe('formulas through links', () => {
	test('a lookup typed through completion follows the linked row', async ({
		page,
		context,
		account
	}) => {
		void account;
		const paths = await seedGym(context.request);
		await open(page, paths.sets);

		const looked = at(page, 0, 2);
		await edit(looked);
		const formula = page.getByRole('textbox', { name: 'Formula of Muscle' });
		await expect(formula).toBeFocused();
		await formula.fill('');

		await choose(formula, page, 'ex', 'Exercise');
		await formula.pressSequentially('.');
		const options = page.getByRole('listbox', { name: 'Suggestions' }).getByRole('option');
		await expect(options).toHaveText(['Name', 'Muscle', 'Total']);
		await choose(formula, page, 'mu', 'Muscle');
		await expect(formula).toHaveValue('"Exercise"."Muscle"');
		await formula.press('Enter');
		await expect(formula).toHaveCount(0);
		await expect(looked).toHaveText('chest');
		await expect(at(page, 2, 2)).toHaveText('legs');

		await openTable(page, 'Exercises');
		const muscle = at(page, 0, 1);
		await expect(muscle).toHaveText('chest');
		await edit(muscle);
		const input = page.getByRole('gridcell').getByRole('textbox');
		await input.fill('pecs');
		await input.press('Enter');
		await expect(muscle).toHaveText('pecs');

		await openTable(page, 'Sets');
		await expect(at(page, 0, 2)).toHaveText('pecs');
		await expect(at(page, 1, 2)).toHaveText('pecs');
		await expect(at(page, 2, 2)).toHaveText('legs');
	});

	test('a rollup folds the rows linking here', async ({ page, context, account }) => {
		void account;
		const paths = await seedGym(context.request);
		await open(page, paths.exercises);

		const total = at(page, 0, 2);
		await edit(total);
		const formula = page.getByRole('textbox', { name: 'Formula of Total' });
		await formula.fill('');
		await choose(formula, page, 'su', 'SUM');
		await expect(formula).toHaveValue('SUM(');
		await choose(formula, page, 'se', 'Sets');
		await formula.pressSequentially('.');
		await choose(formula, page, 'k', 'Kg');
		await formula.pressSequentially(')');
		await expect(formula).toHaveValue('SUM("Sets"."Kg")');
		await formula.press('Enter');
		await expect(formula).toHaveCount(0);
		await expect(total).toHaveText('165');
		await expect(at(page, 1, 2)).toHaveText('100');
	});

	test('the field sheet completes a lookup too', async ({ page, context, account }) => {
		void account;
		const paths = await seedGym(context.request);
		await open(page, paths.sets);

		await page.getByRole('columnheader').filter({ hasText: 'Muscle' }).getByRole('button').click();
		await page
			.getByRole('menuitem', { name: 'Field settings', exact: true })
			.or(page.getByRole('dialog').getByRole('button', { name: 'Field settings', exact: true }))
			.click();
		const sheet = page.getByRole('dialog');
		const formula = sheet.getByRole('textbox', { name: 'Formula', exact: true });
		await formula.fill('');
		await choose(formula, page, '"Exercise".mu', 'Muscle');
		await expect(formula).toHaveValue('"Exercise"."Muscle"');
		await sheet.getByRole('button', { name: 'Save', exact: true }).click();
		await expect(sheet).toHaveCount(0);
		await expect(at(page, 0, 2)).toHaveText('chest');
	});

	test('a table outside an aggregate is refused in words', async ({ page, context, account }) => {
		void account;
		const paths = await seedGym(context.request);
		await open(page, paths.exercises);

		await edit(at(page, 0, 2));
		const formula = page.getByRole('textbox', { name: 'Formula of Total' });
		await formula.fill('"Sets"."Kg" * 2');
		await formula.press('Enter');
		await expect(page.getByRole('alert')).toHaveText(
			'"Sets" holds several rows: wrap it in SUM, COUNT…'
		);
	});
});

test.describe('formula functions', () => {
	test('a function completes with its signature and computes', async ({
		page,
		context,
		account
	}) => {
		void account;
		const paths = await seedGym(context.request);
		await open(page, paths.exercises);

		const total = at(page, 0, 2);
		await edit(total);
		const formula = page.getByRole('textbox', { name: 'Formula of Total' });
		await formula.fill('');
		await choose(formula, page, 'lef', 'LEFT');
		await expect(formula).toHaveValue('LEFT(');
		const signature = page.getByTestId('formula-signature');
		await expect(signature).toHaveText('LEFT(text, [count])');
		await expect(signature.getByText('text', { exact: true })).toHaveClass(/text-ink\b/u);
		await choose(formula, page, 'na', 'Name');
		await formula.pressSequentially(', ');
		await expect(signature.getByText('[count]')).toHaveClass(/text-ink\b/u);
		await formula.pressSequentially('3) || LEN("Muscle")');
		await formula.press('Enter');
		await expect(formula).toHaveCount(0);
		await expect(total).toHaveText('Ben5');
		await expect(at(page, 1, 2)).toHaveText('Squ4');
	});

	test.describe('in French', () => {
		test.use({ locale: 'fr-FR' });

		test('the signature names its arguments in French', async ({ page, context, account }) => {
			void account;
			const paths = await seedGym(context.request);
			await open(page, paths.exercises);

			await edit(at(page, 0, 2));
			const formula = page.getByRole('textbox', { name: 'Formule de Total' });
			await formula.fill('');
			await choose(formula, page, 'datedi', 'DATEDIF');
			await expect(page.getByTestId('formula-signature')).toHaveText(
				'DATEDIF(date_début, date_fin, unité)'
			);
		});
	});
});
