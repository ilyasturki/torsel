import names from '#lib/i18n/names.ts';
import { describe, expect, it } from 'vitest';

import type { Actor } from './access.ts';
import { PATH, SOURCE, allowed, canAddRows, canWrite, lockedKeys } from './access.ts';
import { addField, createBase, createTable, defaultViews, insertRows } from './actions.ts';
import { Hlc } from './clock.ts';
import type { Change } from './model.ts';
import { CREATED, DELETED } from './model.ts';
import { Workspace } from './workspace.ts';

const person: Actor = { user: 'u_me', path: 'device' };
const connector: Actor = { user: 'u_me', path: 'connector' };

function sourced() {
	const ws = new Workspace();
	const hlc = new Hlc('t');
	const commit = (changes: Change[]): void => {
		for (const change of changes) ws.stamp(change, hlc.tick());
	};
	const base = createBase(ws, 'Films');
	commit(base.changes);
	const table = createTable(
		ws,
		base.id,
		'Movies',
		[
			{ name: 'Title', type: 'text' },
			{ name: 'Rating', type: 'number' }
		],
		() => defaultViews(names.en)
	);
	commit(table.changes);
	const [title, rating] = table.fieldIds;
	const mine = addField(ws, table.id, { name: 'Notes', type: 'text' });
	commit(mine.changes);
	const rows = insertRows(ws, table.id, [{ [title]: 'Alien', [rating]: 4 }]);
	commit(rows.changes);
	commit([
		{
			id: table.id,
			kind: 'table',
			base: base.id,
			parent: base.id,
			set: { [SOURCE]: { kind: 'rss' } }
		},
		{ id: title, kind: 'field', base: base.id, parent: table.id, set: { [PATH]: 'title' } },
		{ id: rating, kind: 'field', base: base.id, parent: table.id, set: { [PATH]: 'rating' } }
	]);
	const get = (id: string) => ws.get(id);
	return {
		ws,
		get,
		base: base.id,
		table: table.id,
		title,
		rating,
		notes: mine.id,
		row: rows.ids[0]
	};
}

describe('access', () => {
	it("locks a source field's values and leaves the person's own field free", () => {
		const s = sourced();
		const row = { id: s.row, kind: 'row' as const, parent: s.table };
		expect(lockedKeys(s.get, person, row, [s.title, s.rating, s.notes])).toEqual([
			s.title,
			s.rating
		]);
		expect(canWrite(s.get, person, row, [s.notes])).toBe(true);
	});

	it('refuses adding, deleting and restoring rows of a source table', () => {
		const s = sourced();
		const row = { id: s.row, kind: 'row' as const, parent: s.table };
		expect(canAddRows(s.get, person, s.table)).toBe(false);
		expect(canWrite(s.get, person, { id: 'r_new', kind: 'row', parent: s.table }, [s.notes])).toBe(
			false
		);
		expect(lockedKeys(s.get, person, row, [DELETED, CREATED])).toEqual([DELETED, CREATED]);
	});

	it('binds the owner too, but never the connector that fills the table', () => {
		const s = sourced();
		const row = { id: s.row, kind: 'row' as const, parent: s.table };
		expect(lockedKeys(s.get, { user: 'u_me', path: 'mcp' }, row, [s.title])).toEqual([s.title]);
		expect(lockedKeys(s.get, connector, row, [s.title, DELETED])).toEqual([]);
		expect(canAddRows(s.get, connector, s.table)).toBe(true);
	});

	it("locks a source field's type and path, not its name or format", () => {
		const s = sourced();
		const field = { id: s.rating, kind: 'field' as const, parent: s.table };
		expect(lockedKeys(s.get, person, field, ['type', PATH, 'name', 'decimals', DELETED])).toEqual([
			'type',
			PATH
		]);
		const own = { id: s.notes, kind: 'field' as const, parent: s.table };
		expect(lockedKeys(s.get, person, own, ['type', PATH])).toEqual([PATH]);
	});

	it("leaves a table's name and deletion free but never its source", () => {
		const s = sourced();
		const table = { id: s.table, kind: 'table' as const, parent: s.base };
		expect(lockedKeys(s.get, person, table, ['name', DELETED, SOURCE])).toEqual([SOURCE]);
	});

	it('reads kind and parent from the stored record, not from the write', () => {
		const s = sourced();
		const other = createTable(s.ws, s.base, 'Plain', [{ name: 'A', type: 'text' }], () => []);
		const disguised = { id: s.row, kind: 'row' as const, parent: other.id };
		expect(lockedKeys(s.get, person, disguised, [s.title])).toEqual([s.title]);
	});

	it('locks nothing in a table without a source', () => {
		const ws = new Workspace();
		const base = createBase(ws, 'Gym');
		ws.stamp(base.changes[0], new Hlc('t').tick());
		const table = createTable(ws, base.id, 'Lifts', [{ name: 'Kg', type: 'number' }], () => []);
		for (const change of table.changes) ws.stamp(change, new Hlc('u').tick());
		const get = (id: string) => ws.get(id);
		expect(canAddRows(get, person, table.id)).toBe(true);
		expect(
			lockedKeys(get, person, { id: 'r_x', kind: 'row', parent: table.id }, [table.fieldIds[0]])
		).toEqual([]);
	});

	it('takes the locked keys out of a change, and the whole change when nothing is left', () => {
		const s = sourced();
		const change: Change = {
			id: s.row,
			kind: 'row',
			base: s.base,
			parent: s.table,
			set: { [s.title]: 'Aliens', [s.notes]: 'seen twice' }
		};
		expect(allowed(s.get, person, change)?.set).toEqual({ [s.notes]: 'seen twice' });
		expect(allowed(s.get, person, { ...change, set: { [s.title]: 'Aliens' } })).toBeNull();
		expect(allowed(s.get, connector, change)).toBe(change);
	});
});
