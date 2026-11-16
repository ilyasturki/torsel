import defaultNames from '#lib/i18n/names.ts';
import { describe, expect, it } from 'vitest';

import { createBase, createTable, defaultViews, insertRows, updateRecord } from './actions.ts';
import {
	fillChanges,
	fillInputs,
	fillOf,
	fillValue,
	newRows,
	promptFields,
	promptToDisplay,
	promptToStored,
	waitingRows
} from './autofill.ts';
import { Hlc } from './clock.ts';
import type { Change, FieldDef } from './model.ts';
import { Workspace } from './workspace.ts';

function movies() {
	const ws = new Workspace();
	const hlc = new Hlc('a');
	const apply = (changes: Change[]): void => {
		for (const change of changes) ws.stamp(change, hlc.tick());
	};
	const base = createBase(ws, 'Movies');
	apply(base.changes);
	const table = createTable(
		ws,
		base.id,
		'Movies',
		[
			{ name: 'Title', type: 'text' },
			{ name: 'Year', type: 'number' },
			{ name: 'IMDb', type: 'number' },
			{
				name: 'Genre',
				type: 'choice',
				choices: [
					{ name: 'sci-fi', color: null },
					{ name: 'drama', color: null }
				]
			}
		],
		() => defaultViews(defaultNames.en)
	);
	apply(table.changes);
	const [title, year, imdb, genre] = table.fieldIds;
	const rows = insertRows(ws, table.id, [
		{ [title]: 'Dune', [year]: 2024 },
		{ [title]: 'Parasite', [year]: 2019, [imdb]: 8.6 },
		{ [title]: 'Alien' }
	]);
	apply(rows.changes);
	const prompt = `IMDb rating of {{${title}}} ({{${year}}})`;
	apply(updateRecord(ws, imdb, { fill: { prompt, web: true, auto: false, since: 0 } }));
	return { ws, hlc, table: table.id, title, year, imdb, genre, rows: rows.ids, prompt };
}

describe('fill prompts', () => {
	it('store field ids and show names, leaving unknown names as typed', () => {
		const fields = [
			{ id: 'f_title', name: 'Title' },
			{ id: 'f_year', name: 'Year' }
		];
		const stored = promptToStored('Rating of {Title} ({ Year }) on {Nope}', fields);
		expect(stored).toBe('Rating of {{f_title}} ({{f_year}}) on {Nope}');
		expect(promptToDisplay(stored, [{ id: 'f_title', name: 'Name' }, fields[1]])).toBe(
			'Rating of {Name} ({Year}) on {Nope}'
		);
		expect(promptFields(stored)).toEqual(['f_title', 'f_year']);
	});

	it('read a field’s fill and refuse an empty prompt', () => {
		const { ws, imdb, prompt } = movies();
		expect(ws.field(imdb)?.fill).toEqual({ prompt, web: true, auto: false, since: 0 });
		expect(fillOf({ prompt: '  ', web: true })).toBeNull();
		expect(fillOf('text')).toBeNull();
	});
});

describe('fill rows', () => {
	it('waits for every named input and skips a filled cell', () => {
		const { ws, table, imdb, rows } = movies();
		const field = ws.field(imdb) as FieldDef;
		const waiting = waitingRows(ws, field, field.fill!, ws.rows(table));
		expect(waiting.map((row) => row.id)).toEqual([rows[0]]);
		expect(fillInputs(ws, field, field.fill!, waiting[0])).toEqual({ Title: 'Dune', Year: 2024 });
	});

	it('writes only cells still empty, in the field’s type and choices', () => {
		const { ws, imdb, genre, rows } = movies();
		const field = ws.field(imdb) as FieldDef;
		expect(
			fillChanges(ws, field, [
				{ row: rows[0], value: '8.5' },
				{ row: rows[1], value: '9' },
				{ row: rows[2], value: null },
				{ row: 'r_gone', value: '7' }
			])
		).toEqual([expect.objectContaining({ id: rows[0], set: { [imdb]: 8.5 } })]);
		const choice = ws.field(genre) as FieldDef;
		expect(fillValue(choice, 'Sci-Fi')).toBe('sci-fi');
		expect(fillValue(choice, 'horror')).toBeUndefined();
		expect(fillValue({ ...choice, type: 'choices' }, 'drama; sci-fi; nope')).toEqual([
			'drama',
			'sci-fi'
		]);
		expect(fillValue({ ...field, type: 'date' }, '2024-03-01')).toBe('2024-03-01');
		expect(fillValue({ ...field, type: 'check' }, 'true')).toBe(true);
		expect(fillValue(field, 'eight')).toBeUndefined();
	});

	it('fills a new row once: an undone fill stays empty after a reload, a newer row still fills', () => {
		const { ws, hlc, table, title, year, imdb, rows } = movies();
		const field = ws.field(imdb) as FieldDef;
		const spec = { ...field.fill!, auto: true };
		const auto = (on: Workspace): string[] =>
			waitingRows(on, field, spec, newRows(field, spec, on.rows(table))).map((row) => row.id);
		expect(auto(ws)).toEqual([rows[0]]);

		const [filled] = fillChanges(ws, field, [{ row: rows[0], value: '8.5' }]);
		const { inverse } = ws.stamp(filled, hlc.tick());
		ws.stamp(inverse, hlc.tick());
		expect(ws.live(rows[0])?.data[imdb]).toBeNull();

		const reloaded = new Workspace();
		for (const rec of ws.records.values()) reloaded.put(structuredClone(rec));
		const later = insertRows(reloaded, table, [{ [title]: 'Heat', [year]: 1995, [imdb]: null }]);
		for (const change of later.changes) reloaded.stamp(change, hlc.tick());
		expect(auto(reloaded)).toEqual(later.ids);
	});
});
