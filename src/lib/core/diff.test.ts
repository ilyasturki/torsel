import names from '#lib/i18n/names.ts';
import { describe, expect, it } from 'vitest';

import {
	createBase,
	createTable,
	defaultViews,
	deleteRecords,
	insertRows,
	updateRecord,
	updateRow
} from './actions.ts';
import { Hlc } from './clock.ts';
import { diffOf, stampAll } from './diff.ts';
import type { Change } from './model.ts';
import type { ThreadAction } from './thread.ts';
import { Workspace } from './workspace.ts';

function movies() {
	const ws = new Workspace();
	const hlc = new Hlc('t');
	let n = 0;
	const act = (summary: string, changes: Change[]): ThreadAction => ({
		id: `a${(n += 1)}`,
		turn: 1,
		summary,
		changes,
		before: stampAll(ws, hlc, changes),
		status: 'applied'
	});
	const base = createBase(ws, 'Movies');
	act('base', base.changes);
	const table = createTable(
		ws,
		base.id,
		'Movies',
		[
			{ name: 'Title', type: 'text' },
			{ name: 'Rating', type: 'number' },
			{ name: 'Notes', type: 'text' }
		],
		() => defaultViews(names.en)
	);
	const made = act('table', table.changes);
	const [title, rating, notes] = table.fieldIds;
	return { ws, act, made, table, title, rating, notes };
}

describe('diffOf', () => {
	it('shows a new table with its fields and views', () => {
		const { ws, made } = movies();
		const diff = diffOf(ws, made);
		expect(diff.made.map((item) => `${item.kind} ${item.name}`)).toEqual([
			'table Movies',
			'field Title',
			'field Rating',
			'field Notes',
			'view Grid',
			'view Entry'
		]);
	});

	it('shows added rows by their values, an edit as before and after, a deleted field with what it held', () => {
		const { ws, act, table, title, rating, notes } = movies();
		const inserted = insertRows(ws, table.id, [
			{ [title]: 'Dune: Part Two', [rating]: 8, [notes]: 'with Sara' },
			{ [title]: 'Parasite', [rating]: 9 }
		]);
		const added = act('Add 2 rows to Movies', inserted.changes);
		expect(diffOf(ws, added).tables[0].added.map((row) => [row.title, row.cells.length])).toEqual([
			['Dune: Part Two', 3],
			['Parasite', 2]
		]);

		const parasite = inserted.ids[1];
		const edited = act('Change 1 row in Movies', updateRow(ws, parasite, { [rating]: 10 }));
		const changed = diffOf(ws, edited).tables[0].changed;
		expect(changed).toHaveLength(1);
		expect(changed[0]).toMatchObject({ title: 'Parasite' });
		expect(changed[0].cells.map((cell) => [cell.field.name, cell.before, cell.after])).toEqual([
			['Rating', 9, 10]
		]);

		const gone = act('Delete field "Notes"', deleteRecords(ws, [notes]));
		const field = diffOf(ws, gone).gone[0];
		expect(field).toMatchObject({ kind: 'field', name: 'Notes' });
		expect(field.values.map((row) => [row.title, row.cells[0].before])).toEqual([
			['Dune: Part Two', 'with Sara']
		]);
	});

	it('keeps a deleted row whole, so it can show and come back', () => {
		const { ws, act, table, title } = movies();
		const inserted = insertRows(ws, table.id, [{ [title]: 'Alien' }]);
		act('add', inserted.changes);
		const removed = act('Delete 1 row', deleteRecords(ws, inserted.ids));
		expect(diffOf(ws, removed).tables[0].removed[0]).toMatchObject({ title: 'Alien' });
		expect(removed.before[0].set).toMatchObject({ [title]: 'Alien', _del: null });
	});

	it('words a renamed field and its new choices', () => {
		const { ws, act, title } = movies();
		const renamed = act(
			'Change field',
			updateRecord(ws, title, { name: 'Film', choices: [{ name: 'x', color: null }] })
		);
		expect(diffOf(ws, renamed).edits[0].lines).toEqual([
			{ label: 'name', before: 'Title', after: 'Film' },
			{ label: 'newChoices', before: '', after: 'x' }
		]);
	});
});
