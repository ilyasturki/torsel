import names from '#lib/i18n/names.ts';
import { describe, expect, it } from 'vitest';

import {
	createBase,
	createTable,
	createView,
	defaultViews,
	insertRows,
	updateRecord
} from '../../core/actions.ts';
import { Hlc } from '../../core/clock.ts';
import type { Change } from '../../core/model.ts';
import type { ThreadContext } from '../../core/thread.ts';
import { Workspace } from '../../core/workspace.ts';
import { contextNote } from './assistant.ts';

function movies() {
	const ws = new Workspace();
	const hlc = new Hlc('t');
	const commit = (changes: Change[]): void => {
		for (const change of changes) ws.stamp(change, hlc.tick());
	};
	const base = createBase(ws, 'Movies');
	commit(base.changes);
	const table = createTable(
		ws,
		base.id,
		'Movies',
		[
			{ name: 'Title', type: 'text' },
			{ name: 'Status', type: 'choice', choices: [{ name: 'watched', color: null }] },
			{ name: 'Rating', type: 'number', description: 'Out of 10' }
		],
		() => defaultViews(names.en)
	);
	commit(table.changes);
	const rows = insertRows(ws, table.id, [
		{ [table.fieldIds[0]]: 'Dune', [table.fieldIds[2]]: 8 },
		{ [table.fieldIds[0]]: 'Alien' }
	]);
	commit(rows.changes);
	const grid = ws.views(table.id)[0];
	commit(
		updateRecord(ws, grid.id, {
			config: { sort: [{ field: table.fieldIds[2], dir: 'desc' }] }
		})
	);
	return { ws, base, table, rows, grid };
}

const at = (context: Partial<ThreadContext>): ThreadContext => ({
	screen: 'home',
	base: null,
	table: null,
	view: null,
	rows: [],
	fields: [],
	today: '2026-11-02',
	...context
});

describe('contextNote', () => {
	it('gives the open table whole: schema, view, sort and selected values', () => {
		const { ws, base, table, rows, grid } = movies();
		const note = contextNote(
			ws,
			at({
				screen: 'table',
				base: base.id,
				table: table.id,
				view: grid.id,
				rows: [rows.ids[0]],
				fields: [table.fieldIds[2]]
			}),
			[],
			false
		);
		expect(note).toContain('Today: 2026-11-02.');
		expect(note).toContain(`table "Movies" (${table.id}) in base "Movies" (${base.id}), 2 rows`);
		expect(note).toContain(`view "Grid" (${grid.id}, grid), sorted by Rating descending`);
		expect(note).toContain('Status (');
		expect(note).toContain('choice: watched');
		expect(note).toContain('"Out of 10"');
		expect(note).toContain('Selected: 1 row, in Rating.');
		expect(note).toContain(`- ${rows.ids[0]}: {"Rating":8}`);
	});

	it('says where a linked table fills itself from, and what its last read hit', () => {
		const { ws, base, table } = movies();
		const note = contextNote(
			ws,
			at({ screen: 'table', base: base.id, table: table.id }),
			[],
			false,
			{ host: 'letterboxd.com', every: 'hour', problem: 'auth' }
		);
		expect(note).toContain(
			'This table fills itself from letterboxd.com, every hour; its last read failed: the link refused the request: it needs a key.'
		);
	});

	it('says which page is open when no table is, with every table to reach', () => {
		const { ws, table } = movies();
		const home = contextNote(ws, at({}), [], false);
		expect(home).toContain('Screen: the home page');
		expect(home).toContain(`"Movies" (${table.id}, 2 rows)`);
		expect(contextNote(ws, at({ screen: 'settings' }), [], false)).toContain(
			'Screen: the settings page'
		);
	});

	it("gives a chart's settings by field name, and how the screen writes dates and numbers", () => {
		const { ws, base, table } = movies();
		const hlc = new Hlc('c');
		const made = createView(ws, table.id, {
			name: 'Per month',
			type: 'chart',
			config: {
				kind: 'bar',
				x: table.fieldIds[0],
				agg: 'avg',
				y: table.fieldIds[2],
				bucket: 'month'
			}
		});
		for (const change of made.changes) ws.stamp(change, hlc.tick());
		const note = contextNote(
			ws,
			at({
				screen: 'table',
				base: base.id,
				table: table.id,
				view: made.id,
				shows: { locale: 'fr-FR', today: '2 nov.', past: '7 mai 2025', number: '1 234,5' }
			}),
			[],
			false
		);
		expect(note).toContain(
			'The chart view is set to {"x":"Title","y":"Rating","kind":"bar","bucket":"month","agg":"avg"}.'
		);
		expect(note).toContain(
			'Their screen (fr-FR) writes today as "2 nov.", a date of another year as "7 mai 2025" and a number as "1 234,5"'
		);
	});

	it('keeps the screen’s date form in a reply in another language', () => {
		const { ws } = movies();
		const note = contextNote(
			ws,
			at({ shows: { locale: 'en-US', today: 'Nov 2', past: 'May 7, 2025', number: '12,345.5' } }),
			[],
			false
		);
		expect(note).toContain('in whatever language you reply ("Nov 2" stays "Nov 2", never translated)');
		expect(note).toContain("its dates and numbers in their screen's form");
	});

	it('says a filled field searches the web, and fills new rows', () => {
		const { ws, base, table } = movies();
		const hlc = new Hlc('w');
		const [title, , rating] = table.fieldIds;
		const fill = { prompt: `IMDb rating of {{${title}}}`, web: true, auto: true, since: 0 };
		for (const change of updateRecord(ws, rating, { fill })) ws.stamp(change, hlc.tick());
		const note = contextNote(ws, at({ screen: 'table', base: base.id, table: table.id }), [], false);
		expect(note).toContain(
			'filled by AI from "IMDb rating of {Title}" with a web search on new rows'
		);
	});

	it('tells what the person undid', () => {
		const { ws } = movies();
		const note = contextNote(
			ws,
			at({}),
			[
				{
					id: 'a',
					turn: 1,
					summary: 'Add 6 rows to Movies',
					changes: [],
					before: [],
					status: 'undone'
				}
			],
			true
		);
		expect(note).toContain('The person stopped your previous reply');
		expect(note).toContain('- Add 6 rows to Movies.');
	});
});
