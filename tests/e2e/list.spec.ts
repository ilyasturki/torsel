import names from '../../src/lib/i18n/names.ts';
import type { APIRequestContext } from '@playwright/test';

import {
	createBase,
	createTable,
	defaultViews,
	createView,
	insertRows
} from '../../src/lib/core/actions.ts';
import { expect, seed, tablePath, test, toastButton } from './harness.ts';

function seedChores(request: APIRequestContext) {
	return seed(request, (ws, commit) => {
		const base = createBase(ws, 'Home');
		commit(base.changes);
		const chores = createTable(
			ws,
			base.id,
			'Chores',
			[
				{ name: 'Task', type: 'text' },
				{ name: 'Done', type: 'check' },
				{
					name: 'Room',
					type: 'choice',
					choices: [
						{ name: 'kitchen', color: 'amber' },
						{ name: 'garden', color: 'green' }
					]
				},
				{ name: 'Minutes', type: 'number' }
			],
			() => defaultViews(names.en)
		);
		commit(chores.changes);
		const [task, done, room, minutes] = chores.fieldIds;
		commit(
			insertRows(ws, chores.id, [
				{ [task]: 'Mow the lawn', [done]: false, [room]: 'garden', [minutes]: 40 },
				{ [task]: 'Descale the kettle', [done]: false, [room]: 'kitchen', [minutes]: 10 }
			]).changes
		);
		const list = createView(ws, chores.id, {
			name: 'Chores',
			type: 'list',
			config: { group: null, title: task, show: [done, room, minutes] }
		});
		commit(list.changes);
		return tablePath(chores.id, list.id);
	});
}

test('a list row ticks, changes its choice in place and opens on its title', async ({
	page,
	context,
	account
}) => {
	void account;
	await page.goto(await seedChores(context.request));
	const kettle = page
		.locator('div')
		.filter({ has: page.getByText('Descale the kettle') })
		.last();

	await expect(kettle.getByText('10', { exact: true })).toBeVisible();
	await kettle.getByRole('checkbox', { name: 'Done' }).click();
	await expect(kettle.getByRole('checkbox', { name: 'Done' })).toBeChecked();
	await toastButton(page, 'Undo').click();
	await expect(kettle.getByRole('checkbox', { name: 'Done' })).not.toBeChecked();

	await kettle.getByRole('button', { name: 'Room: kitchen' }).click();
	await page.getByRole('menuitem', { name: 'garden' }).click();
	await expect(kettle.getByRole('button', { name: 'Room: garden' })).toBeVisible();
	await expect(page.getByRole('status')).toContainText('Row changed');

	await kettle.getByRole('button', { name: 'Descale the kettle' }).click();
	const sheet = page.getByRole('dialog', { name: 'Descale the kettle' });
	await expect(sheet.getByLabel('Minutes')).toHaveValue('10');
	await sheet.getByRole('button', { name: 'Next row' }).click();
	await expect(page.getByRole('dialog', { name: 'Mow the lawn' })).toBeVisible();
});
