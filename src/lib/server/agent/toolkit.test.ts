import { describe, expect, it, vi } from 'vitest';

import { PATH, SOURCE } from '../../core/access.ts';
import { updateRecord } from '../../core/actions.ts';
import { Hlc } from '../../core/clock.ts';
import { Workspace } from '../../core/workspace.ts';
import type { Effect } from '../../core/thread.ts';
import { inLocale, requestLocale } from '../http/locale.ts';
import type { ImageRef } from '../../core/images.ts';
import type { ImageHost } from '../images/host.ts';
import { IngestFailed } from '../images/ingest.ts';
import type { Sheet } from './files.ts';
import type { Action, ToolContext } from './toolkit.ts';
import catalog from '../../i18n/assistant.ts';
import { TOOLS, runTool, toolNamed } from './toolkit.ts';

vi.mock('$app/env', () => ({ building: false }));

function session(sheets: Record<string, Sheet> = {}): {
	ctx: ToolContext;
	actions: Action[];
	shown: Effect[];
	call: (name: string, input: unknown) => Promise<unknown>;
} {
	const ws = new Workspace();
	const hlc = new Hlc('ai');
	const actions: Action[] = [];
	const shown: Effect[] = [];
	const ctx: ToolContext = {
		ws,
		actor: { user: 'u_test', path: 'assistant' },
		commit(action) {
			for (const change of action.changes) {
				ws.stamp(change, hlc.tick());
			}
			actions.push(action);
		},
		show: (effect) => shown.push(effect),
		sheet: (file) => sheets[file] ?? null
	};

	const call = async (name: string, input: unknown): Promise<unknown> => {
		const tool = toolNamed(name);
		if (tool === undefined) throw new Error(name);
		const outcome = await runTool(ctx, tool, input);
		return outcome.ok ? outcome.result : { error: outcome.error };
	};

	return { ctx, actions, shown, call };
}

describe('assistant tools', () => {
	it('applies what it writes and reads back its own changes', async () => {
		const { ctx, actions, call } = session();

		await call('create_base', { name: 'Muscu' });
		await call('create_table', {
			base: 'Muscu',
			name: 'Séries',
			fields: [
				{ name: 'Date', type: 'date' },
				{ name: 'Exercice', type: 'choice', choices: ['bench press'] },
				{ name: 'Poids', type: 'number' },
				{ name: 'Reps', type: 'number' }
			]
		});
		expect(actions.map((action) => action.summary)).toEqual([
			'New base "Muscu"',
			'New table "Séries"'
		]);

		const added = await call('add_rows', {
			base: 'Muscu',
			table: 'Séries',
			rows: [
				{ Date: '2026-10-29', Exercice: 'bench press', Poids: 80, Reps: 8 },
				{ Date: '2026-10-29', Exercice: 'squat', Poids: '100,5', Reps: 5 }
			]
		});
		expect(added).toHaveProperty('added');
		expect(actions[2].summary).toBe('Add 2 rows to Séries');
		expect(
			ctx.ws
				.fields(ctx.ws.tables(ctx.ws.bases()[0].id)[0].id)[1]
				.choices.map((choice) => choice.name)
		).toEqual(['bench press', 'squat']);

		const refused = await call('add_field', {
			base: 'Muscu',
			table: 'Séries',
			name: 'X',
			type: 'formula',
			formula: 'nope("Poids")'
		});
		expect(refused).toEqual({ error: expect.stringMatching(/no such function/u) });
		const total = await call('add_field', {
			base: 'Muscu',
			table: 'Séries',
			name: 'Total',
			type: 'formula',
			formula: 'SUM("Poids")'
		});
		expect(total).toEqual({ error: expect.stringMatching(/column total/u) });

		await call('add_field', {
			base: 'Muscu',
			table: 'Séries',
			name: '1RM estimé',
			type: 'formula',
			formula: 'ROUND("Poids" * (1 + "Reps" / 30.0), 1)'
		});

		const rows = (await call('query', {
			base: 'Muscu',
			sql: 'select "Exercice", "1RM estimé", "_id" from "Séries" order by "Exercice"'
		})) as { columns: string[]; rows: [string, number, string][] };
		expect(rows.columns).toEqual(['Exercice', '1RM estimé', '_id']);
		expect(rows.rows.map(([exercise, max]) => [exercise, max])).toEqual([
			['bench press', 101.3],
			['squat', 117.3]
		]);

		await call('delete_rows', { base: 'Muscu', table: 'Séries', ids: [rows.rows[1][2]] });
		expect(actions.at(-1)?.summary).toBe('Delete 1 row from Séries');
	});

	it('creates a table without naming a base', async () => {
		const { call, actions, ctx } = session();

		const first = (await call('create_table', {
			name: 'Weight',
			fields: [{ name: 'Kg', type: 'number' }]
		})) as { id: string; base: string };
		const second = (await call('create_table', {
			name: 'Expenses',
			fields: [{ name: 'Amount', type: 'number' }]
		})) as { id: string; base: string };

		expect(actions).toHaveLength(2);
		expect(second.base).toBe(first.base);
		expect(ctx.ws.tables(first.base).map((table) => table.name)).toEqual(['Weight', 'Expenses']);
	});

	it('colors the choices it creates as the app does, and keeps those already there', async () => {
		const { call, ctx } = session();
		const colors = (field: string): Record<string, string | null> => {
			const table = ctx.ws.tables(ctx.ws.bases()[0].id)[0];
			const found = ctx.ws.fields(table.id).find((candidate) => candidate.name === field);
			return Object.fromEntries((found?.choices ?? []).map((one) => [one.name, one.color]));
		};

		await call('create_table', {
			name: 'Clients',
			fields: [
				{ name: 'Name', type: 'text' },
				{ name: 'Stage', type: 'choice', choices: ['Lead', 'Talking'] }
			]
		});
		expect(colors('Stage')).toEqual({ Lead: 'orange', Talking: 'amber' });

		await call('add_rows', {
			base: 'Tables',
			table: 'Clients',
			rows: [{ Name: 'Acme', Stage: 'Won' }]
		});
		expect(colors('Stage')).toEqual({ Lead: 'orange', Talking: 'amber', Won: 'green' });

		await call('update_field', {
			base: 'Tables',
			table: 'Clients',
			field: 'Stage',
			choices: ['Lead', 'Talking', 'Won', 'Lost']
		});
		expect(colors('Stage')).toEqual({
			Lead: 'orange',
			Talking: 'amber',
			Won: 'green',
			Lost: 'teal'
		});

		await call('add_field', {
			base: 'Tables',
			table: 'Clients',
			name: 'Size',
			type: 'choice',
			choices: ['Big']
		});
		expect(colors('Size')).toEqual({ Big: 'orange' });
	});

	it('answers a bad name with the way to find the right one', async () => {
		const { call } = session();

		expect(await call('describe_base', { base: 'Nulle part' })).toEqual({
			error: 'no base "Nulle part": there is none'
		});
		await call('create_base', { name: 'Muscu' });
		expect(await call('describe_base', { base: 'Nulle part' })).toEqual({
			error: 'no base "Nulle part"; the bases are "Muscu"'
		});
		expect(await call('add_rows', { base: 'x' })).toEqual({ error: expect.any(String) });
	});

	it('sets a field to fill by AI from a prompt over named fields, and turns it off', async () => {
		const { call, ctx } = session();
		const made = (await call('create_table', {
			name: 'Films',
			fields: [
				{ name: 'Title', type: 'text' },
				{ name: 'IMDb', type: 'number' }
			]
		})) as { id: string; base: string };
		const [title, imdb] = ctx.ws.fields(made.id);
		expect(
			await call('update_field', {
				base: made.base,
				table: made.id,
				field: 'IMDb',
				fill: { prompt: 'IMDb rating of {Title}', web: true }
			})
		).toEqual({ updated: imdb.id, lost: 0 });
		expect(ctx.ws.field(imdb.id)?.fill).toEqual({
			prompt: `IMDb rating of {{${title.id}}}`,
			web: true,
			auto: false,
			since: 0
		});
		expect(
			await call('update_field', {
				base: made.base,
				table: made.id,
				field: 'IMDb',
				fill: { prompt: 'Rating of {Name}' }
			})
		).toEqual({ error: 'no field named "Name"; the fields are "Title", "IMDb"' });
		await call('update_field', { base: made.base, table: made.id, field: 'IMDb', fill: null });
		expect(ctx.ws.field(imdb.id)?.fill).toBeNull();
	});

	it('sets a date look and a formula result format, as the field sheet does', async () => {
		const { call, ctx } = session();
		const made = (await call('create_table', {
			name: 'Weigh-ins',
			fields: [
				{ name: 'Day', type: 'date' },
				{ name: 'Kg', type: 'number' }
			]
		})) as { id: string; base: string };
		await call('add_field', {
			base: made.base,
			table: made.id,
			name: 'Pounds',
			type: 'formula',
			formula: '"Kg" * 2.2046'
		});

		await call('update_field', {
			base: made.base,
			table: made.id,
			field: 'Day',
			dateStyle: 'weekday'
		});
		const pounds = await call('update_field', {
			base: made.base,
			table: made.id,
			field: 'Pounds',
			result: 'number',
			decimals: 1
		});
		expect(pounds).toEqual({ updated: expect.any(String), lost: 0 });

		const [day, , formula] = ctx.ws.fields(made.id);
		expect(day.dateStyle).toBe('weekday');
		expect(formula).toMatchObject({ result: 'number', decimals: 1, expr: expect.any(String) });
		expect(await call('describe_base', { base: made.base })).toMatchObject({
			tables: [
				{
					fields: expect.arrayContaining([
						expect.objectContaining({ name: 'Day', dateStyle: 'weekday' }),
						expect.objectContaining({ name: 'Pounds', result: 'number', decimals: 1 })
					])
				}
			]
		});
	});

	it('duplicates a table, a field, a view and rows, as the menus do', async () => {
		const { call, ctx } = session();
		const made = (await call('create_table', {
			name: 'Movies',
			fields: [
				{ name: 'Title', type: 'text' },
				{ name: 'Rating', type: 'number' }
			]
		})) as { id: string; base: string };
		await call('add_rows', {
			base: made.base,
			table: made.id,
			rows: [
				{ Title: 'Dune', Rating: 8 },
				{ Title: 'Heat', Rating: 9 }
			]
		});
		const at = { base: made.base, table: made.id };

		const field = (await call('duplicate', { ...at, field: 'Rating' })) as { created: string };
		expect(ctx.ws.field(field.created)?.name).toBe('Rating copy');
		expect(ctx.ws.rows(made.id).map((row) => row.data[field.created])).toEqual([8, 9]);

		const view = (await call('duplicate', { ...at, view: 'Grid', name: 'Best' })) as {
			created: string;
		};
		expect(ctx.ws.views(made.id).map((one) => one.name)).toEqual(['Grid', 'Best', 'Entry']);
		expect(view.created).toMatch(/^v_/u);

		const [dune] = ctx.ws.rows(made.id);
		const rows = (await call('duplicate', { ...at, rows: [dune.id] })) as { added: string[] };
		expect(rows.added).toHaveLength(1);
		expect(ctx.ws.rows(made.id).map((row) => row.data[ctx.ws.fields(made.id)[0].id])).toEqual([
			'Dune',
			'Dune',
			'Heat'
		]);
		expect(await call('duplicate', { ...at, rows: ['r_nothere000'] })).toEqual({
			error: expect.stringMatching(/no row/u)
		});

		const table = (await call('duplicate', at)) as { created: string };
		expect(ctx.ws.table(table.created)?.name).toBe('Movies copy');
		expect(ctx.ws.rows(table.created)).toHaveLength(3);
	});

	it('renames, resorts a view and deletes a base, as the person can by hand', async () => {
		const { call, actions, ctx } = session();
		const made = (await call('create_table', {
			name: 'Movies',
			fields: [
				{ name: 'Title', type: 'text' },
				{ name: 'Rating', type: 'number' }
			]
		})) as { id: string; base: string };
		const grid = ctx.ws.views(made.id)[0];

		await call('rename', { base: made.base, id: made.id, name: 'Films' });
		expect(ctx.ws.table(made.id)?.name).toBe('Films');

		await call('update_view', {
			base: made.base,
			table: 'Films',
			view: grid.name,
			config: {
				sort: [
					{ field: 'Rating', dir: 'desc' },
					{ field: 'Title', dir: 'asc' }
				]
			}
		});
		const [title, rating] = ctx.ws.fields(made.id).map((field) => field.id);
		expect(ctx.ws.view(grid.id)?.config.sort).toEqual([
			{ field: rating, dir: 'desc' },
			{ field: title, dir: 'asc' }
		]);
		expect(await call('describe_base', { base: made.base })).toMatchObject({
			tables: [
				{
					views: expect.arrayContaining([
						expect.objectContaining({
							config: {
								sort: [
									{ field: 'Rating', dir: 'desc' },
									{ field: 'Title', dir: 'asc' }
								]
							}
						})
					])
				}
			]
		});

		await call('update_view', {
			base: made.base,
			table: 'Films',
			view: grid.id,
			config: { sort: null }
		});
		expect(ctx.ws.view(grid.id)?.config.sort).toBeNull();

		await call('delete', { base: made.base, id: made.base });
		expect(ctx.ws.bases()).toEqual([]);
		expect(actions.at(-1)?.summary).toMatch(/^Delete base/u);
	});

	it('shows a table or a page rather than changing anything', async () => {
		const { call, actions, shown } = session();
		const made = (await call('create_table', {
			name: 'Pesées',
			fields: [{ name: 'Kg', type: 'number' }]
		})) as { id: string };

		await call('open', { table: 'pesées' });
		await call('open', { page: 'settings' });
		await call('export', {});
		expect(shown).toEqual([
			{ kind: 'open', table: made.id, view: null },
			{ kind: 'settings' },
			{ kind: 'export' }
		]);
		expect(await call('open', { table: 'Nowhere' })).toEqual({ error: expect.any(String) });
		expect(actions).toHaveLength(1);
	});

	it('imports an attached sheet into a new table, then appends to it by column name', async () => {
		const { call, ctx } = session({
			first: {
				kind: 'table',
				name: 'kilorep.csv',
				rows: [
					['Date', 'Exercise', 'Weight'],
					['2026-10-01', 'bench press', '80'],
					['2026-10-02', 'squat', '100']
				]
			},
			more: {
				kind: 'table',
				name: 'more.csv',
				rows: [
					['Weight', 'Exercise'],
					['85', 'bench press']
				]
			}
		});

		const made = (await call('import_file', { file: 'first' })) as { id: string };
		expect(ctx.ws.table(made.id)?.name).toBe('kilorep');
		expect(ctx.ws.rows(made.id)).toHaveLength(2);

		expect(await call('import_file', { file: 'more', table: 'kilorep' })).toMatchObject({
			added: 1
		});
		const weight = ctx.ws.fields(made.id).find((field) => field.name === 'Weight');
		expect(ctx.ws.rows(made.id).map((row) => row.data[weight?.id ?? ''])).toContain(85);
		expect(await call('import_file', { file: 'missing' })).toEqual({ error: expect.any(String) });
	});

	it('types each field with its format, and retypes one with what its values become', async () => {
		const { ctx, call } = session();

		await call('create_table', {
			name: 'Movies',
			fields: [
				{ name: 'Title', type: 'text' },
				{ name: 'Year', type: 'number', grouping: false },
				{ name: 'Rating', type: 'rating', max: 10, step: 0.5 },
				{ name: 'Price', type: 'currency', currency: 'USD' },
				{ name: 'Runtime', type: 'duration' },
				{ name: 'Genres', type: 'choices', choices: ['Drama'] },
				{ name: 'Score', type: 'number' }
			]
		});
		const table = ctx.ws.tables(ctx.ws.bases()[0].id)[0];
		const field = (name: string) =>
			ctx.ws.fields(table.id).find((candidate) => candidate.name === name);
		expect(field('Year')).toMatchObject({ type: 'number', grouping: false });
		expect(field('Rating')).toMatchObject({ type: 'rating', max: 10, step: 0.5, min: null });
		expect(field('Price')).toMatchObject({ currency: 'USD' });

		await call('add_rows', {
			base: 'Tables',
			table: 'Movies',
			rows: [
				{
					Title: 'Dune',
					Year: 2021,
					Rating: 8.5,
					Price: '$12.50',
					Runtime: '2:35:00',
					Genres: ['Drama', 'Sci-fi'],
					Score: 8
				},
				{ Title: 'Cats', Year: 2019, Rating: 2, Score: 12 }
			]
		});
		const [dune] = ctx.ws.rows(table.id);
		expect(dune.data[field('Runtime')?.id ?? '']).toBe(9300);
		expect(dune.data[field('Genres')?.id ?? '']).toEqual(['Drama', 'Sci-fi']);
		expect(field('Genres')?.choices.map((choice) => choice.name)).toEqual(['Drama', 'Sci-fi']);

		const schema = (await call('describe_base', { base: 'Tables' })) as {
			tables: { fields: Record<string, unknown>[] }[];
		};
		expect(schema.tables[0].fields.find((one) => one.name === 'Year')).toMatchObject({
			type: 'number',
			grouping: false
		});
		expect(schema.tables[0].fields.find((one) => one.name === 'Rating')).toMatchObject({
			max: 10,
			step: 0.5
		});

		expect(
			await call('update_field', {
				base: 'Tables',
				table: 'Movies',
				field: 'Score',
				type: 'rating',
				max: 10
			})
		).toEqual({ updated: field('Score')?.id, lost: 1 });
		expect(field('Score')).toMatchObject({ type: 'rating', max: 10 });
		expect(ctx.ws.rows(table.id).map((row) => row.data[field('Score')?.id ?? ''])).toEqual([
			8,
			null
		]);

		const query = (await call('query', {
			base: 'Tables',
			sql: `select count(*) as n from "Movies", json_each("Movies"."Genres") where json_each.value = 'Sci-fi'`
		})) as { rows: unknown[] };
		expect(query.rows).toEqual([[1]]);
	});
});

describe('query limits', () => {
	it('stops a runaway query at its deadline', async () => {
		const { call } = session();
		await call('create_base', { name: 'B' });

		const started = Date.now();
		const answer = await call('query', {
			base: 'B',
			sql: 'with recursive c(x) as (select 1 union all select x + 1 from c) select count(*) from c'
		});

		expect(answer).toEqual({ error: expect.stringMatching(/ran past 500 ms/u) });
		expect(Date.now() - started).toBeLessThan(1500);
	});

	it('refuses a value too long to hold', async () => {
		const { call } = session();
		await call('create_base', { name: 'B' });

		expect(
			await call('query', { base: 'B', sql: `select printf('%.*c', 100000000, 'x') as v` })
		).toEqual({ error: expect.stringMatching(/too big/u) });
	});

	it('pages an answer cut by size, by rows or by cell', async () => {
		const { call } = session();
		await call('create_base', { name: 'B' });

		const big = (await call('query', {
			base: 'B',
			sql: `with recursive c(x) as (select 1 union all select x + 1 from c where x < 150) select x, printf('%.*c', 1900, 'x') as pad from c`
		})) as { rows: unknown[][]; next: number };
		expect(big.next).toBe(big.rows.length);
		expect(JSON.stringify(big.rows).length).toBeLessThan(50_000);

		const many = (await call('query', {
			base: 'B',
			sql: 'with recursive c(x) as (select 1 union all select x + 1 from c where x < 300) select x from c'
		})) as { rows: unknown[][]; next: number };
		expect(many.rows).toHaveLength(200);
		expect(many.next).toBe(200);

		const rest = (await call('query', {
			base: 'B',
			sql: 'with recursive c(x) as (select 1 union all select x + 1 from c where x < 300) select x from c',
			offset: many.next
		})) as { rows: unknown[][]; next: number | null };
		expect(rest.rows).toHaveLength(100);
		expect(rest.rows[0]).toEqual([201]);
		expect(rest.next).toBeNull();

		expect(
			await call('query', { base: 'B', sql: `select printf('%.*c', 3000, 'y') as long` })
		).toEqual({ columns: ['long'], rows: [[`${'y'.repeat(2000)}…`]], next: null, cut: 1 });

		expect(await call('query', { base: 'B', sql: "select 'a;b' as x;" })).toEqual({
			columns: ['x'],
			rows: [['a;b']],
			next: null,
			cut: 0
		});
		expect(await call('query', { base: 'B', sql: 'select 1; select 2' })).toEqual({
			error: 'one statement at a time'
		});
	});

	it('bounds a formula checked on the server', async () => {
		const { call, ctx } = session();
		await call('create_table', { name: 'T', fields: [{ name: 'N', type: 'number' }] });
		await call('add_rows', { base: ctx.ws.bases()[0].id, table: 'T', rows: [{ N: 1 }] });

		const started = Date.now();
		const answer = await call('add_field', {
			base: ctx.ws.bases()[0].id,
			table: 'T',
			name: 'Slow',
			type: 'formula',
			formula: `LENGTH(PRINTF('%.*c', 100000000, 'x'))`
		});

		expect(answer).toEqual({ error: expect.stringMatching(/too big/u) });
		expect(Date.now() - started).toBeLessThan(1500);
	});
});

async function movies(): Promise<ReturnType<typeof session> & { table: string }> {
	const s = session();
	const { id } = (await s.call('create_table', {
		name: 'Movies',
		fields: [
			{ name: 'Title', type: 'text' },
			{ name: 'Watched', type: 'date' },
			{ name: 'Rating', type: 'rating' },
			{ name: 'Year', type: 'number' },
			{ name: 'Favorite', type: 'check' },
			{ name: 'Genre', type: 'choice' }
		]
	})) as { id: string };
	return { ...s, table: id };
}

describe('row tools', () => {
	it('delete or change only rows of the named table, never its fields or views', async () => {
		const { call, ctx, actions, table } = await movies();
		const base = ctx.ws.bases()[0].id;
		const field = ctx.ws.fields(table)[0].id;
		const view = ctx.ws.views(table)[0].id;
		const before = actions.length;

		for (const id of [field, view, table]) {
			const kind = ctx.ws.live(id)?.kind;
			const refusal = `${id} is a ${kind}, not a row of Movies; rows are the "_id" column of query`;
			expect(await call('delete_rows', { base, table: 'Movies', ids: [id] })).toEqual({
				error: refusal
			});
			expect(
				await call('update_rows', {
					base,
					table: 'Movies',
					updates: [{ id, values: { Title: 'x' } }]
				})
			).toEqual({ error: refusal });
		}

		expect(actions).toHaveLength(before);
		expect(ctx.ws.live(field)).toBeDefined();
		expect(ctx.ws.live(view)).toBeDefined();
	});

	it.each([
		['Watched', 'last tuesday', /"Watched": "last tuesday" is not a date \(YYYY-MM-DD\)/u],
		['Rating', 'eight', /"Rating": "eight" is not a rating/u],
		['Rating', 9, /"Rating": 9 is not a rating from 1 to 5/u],
		['Year', 'MMXXI', /"Year": "MMXXI" is not a number/u],
		['Title', true, /"Title": true is not text/u],
		['Favorite', 'maybe', /"Favorite": "maybe" is not a check \(true or false\)/u],
		['Genre', { name: 'Drama' }, /Genre: \{"name":"Drama"\} is not a value/u]
	])('refuse the whole call when %s cannot hold %j', async (field, value, message) => {
		const { call, ctx, actions } = await movies();
		const before = actions.length;

		const added = await call('add_rows', {
			base: ctx.ws.bases()[0].id,
			table: 'Movies',
			rows: [
				{ Title: 'Heat', Year: 1995 },
				{ Title: 'Ronin', [field]: value }
			]
		});

		expect(added).toEqual({ error: expect.stringMatching(message) });
		expect((added as { error: string }).error).toMatch(/^rows\[1\]\./u);
		expect(actions).toHaveLength(before);
	});

	it('refuse an unreadable change too, and still take an empty value as a clear', async () => {
		const { call, ctx } = await movies();
		const base = ctx.ws.bases()[0].id;
		const { added } = (await call('add_rows', {
			base,
			table: 'Movies',
			rows: [{ Title: 'Heat', Year: 1995, Favorite: 'yes' }]
		})) as { added: string[] };

		expect(
			await call('update_rows', {
				base,
				table: 'Movies',
				updates: [{ id: added[0], values: { Year: 'soon' } }]
			})
		).toEqual({
			error: expect.stringMatching(/^updates\[0\]\.values\."Year": "soon" is not a number/u)
		});

		expect(
			await call('update_rows', {
				base,
				table: 'Movies',
				updates: [{ id: added[0], values: { Year: null, Title: '' } }]
			})
		).toEqual({ updated: 1 });
	});
});

describe('the language of what the assistant writes', () => {
	it('follows the request, even once the turn runs on in its stream', async () => {
		const { ctx, actions, call } = session();
		const french = new Request('http://torsel.test', {
			headers: { 'accept-language': 'fr-FR,fr;q=0.9,en;q=0.8' }
		});
		await new Promise<void>((resolve) => {
			new ReadableStream({
				start() {
					void inLocale(requestLocale(french), async () => {
						await call('create_table', { name: 'Poids', fields: [{ name: 'Kg', type: 'number' }] });
						await new Promise((wait) => setTimeout(wait, 0));
						await call('add_rows', {
							base: 'Tables',
							table: 'Poids',
							rows: [{ Kg: 80 }, { Kg: 81 }]
						});
					}).then(resolve);
				}
			});
		});
		await call('add_rows', { base: 'Tables', table: 'Poids', rows: [{ Kg: 79 }] });

		expect(actions.map((action) => action.summary)).toEqual([
			'Nouvelle table « Poids »',
			'2 lignes ajoutées à Poids',
			'Add 1 row to Poids'
		]);
		const [table] = ctx.ws.tables(ctx.ws.bases()[0].id);
		expect(ctx.ws.views(table.id).map((view) => view.name)).toEqual(['Grille', 'Saisie']);
	});
});

describe('source tables', () => {
	async function sourced() {
		const s = session();
		await s.call('create_table', {
			name: 'Movies',
			fields: [
				{ name: 'Title', type: 'text' },
				{ name: 'Rating', type: 'number' },
				{ name: 'Notes', type: 'text' }
			]
		});
		const ws = s.ctx.ws;
		const table = ws.bases().flatMap((base) => ws.tables(base.id))[0];
		const [title, rating] = ws.fields(table.id);
		await s.call('add_rows', {
			table: 'Movies',
			base: table.base,
			rows: [{ Title: 'Alien', Rating: 4 }]
		});
		const hlc = new Hlc('conn');
		for (const change of [
			...updateRecord(ws, table.id, { [SOURCE]: { kind: 'rss' } }),
			...updateRecord(ws, title.id, { [PATH]: 'title' }),
			...updateRecord(ws, rating.id, { [PATH]: 'rating' })
		]) {
			ws.stamp(change, hlc.tick());
		}
		const row = ws.rows(table.id)[0].id;
		const written = s.actions.length;
		return { ...s, base: table.base, row, written };
	}

	it('refuses writing source values and says where to go instead', async () => {
		const s = await sourced();
		const refused = await s.call('update_rows', {
			base: s.base,
			table: 'Movies',
			updates: [{ id: s.row, values: { Title: 'Aliens', Notes: 'seen' } }]
		});
		expect(refused).toEqual({
			error:
				'"Movies" gets "Title", "Rating" from its source: change them there, or add your own field beside them'
		});
		expect(s.actions).toHaveLength(s.written);

		await s.call('update_rows', {
			base: s.base,
			table: 'Movies',
			updates: [{ id: s.row, values: { Notes: 'seen' } }]
		});
		expect(s.actions).toHaveLength(s.written + 1);
	});

	it('refuses adding and deleting rows of a source table', async () => {
		const s = await sourced();
		const rows = 'gets its rows from its source';
		expect(
			await s.call('add_rows', { base: s.base, table: 'Movies', rows: [{ Notes: 'x' }] })
		).toEqual({ error: expect.stringContaining(rows) });
		expect(await s.call('delete_rows', { base: s.base, table: 'Movies', ids: [s.row] })).toEqual({
			error: expect.stringContaining(rows)
		});
		expect(s.actions).toHaveLength(s.written);
	});

	it("refuses a source field's type and takes its format without touching its values", async () => {
		const s = await sourced();
		expect(
			await s.call('update_field', { base: s.base, table: 'Movies', field: 'Rating', type: 'text' })
		).toEqual({ error: '"Rating" in "Movies" gets its type from its source' });

		await s.call('update_field', { base: s.base, table: 'Movies', field: 'Rating', decimals: 2 });
		const changes = s.actions.at(-1)?.changes ?? [];
		expect(changes.some((change) => change.kind === 'row')).toBe(false);
		expect(changes[0].set.decimals).toBe(2);
	});
});

describe('step line', () => {
	it('names every tool in both languages', () => {
		for (const tool of TOOLS) {
			expect(catalog.en.steps[tool.name], tool.name).toBeTruthy();
			expect(catalog.fr.steps[tool.name], tool.name).toBeTruthy();
		}
	});
});

describe('image writes', () => {
	const ref = (letter: string, src?: string): ImageRef => ({
		id: letter.repeat(64),
		type: 'image/jpeg',
		w: 342,
		h: 513,
		size: 9000,
		...(src === undefined ? {} : { src })
	});

	function withImages() {
		const s = session();
		const fetched: string[] = [];
		const images: ImageHost = {
			async fromUrl(_, url) {
				fetched.push(url);
				if (url.includes('gone')) throw new IngestFailed('status');
				return ref(url.includes('alien') ? 'b' : 'a', url);
			},
			fromFile: (_, name) => (name === 'receipt.jpg' ? { ...ref('c'), name } : null),
			fromId: (_, id) => (id === 'd'.repeat(64) ? ref('d') : null)
		};
		s.ctx.images = images;
		return { ...s, fetched };
	}

	async function posters(s: ReturnType<typeof withImages>) {
		await s.call('create_table', {
			name: 'Movies',
			fields: [
				{ name: 'Title', type: 'text' },
				{ name: 'Poster', type: 'image' }
			]
		});
		return s.ctx.ws.bases()[0].id;
	}

	it('stores a linked image, an attached file and a stored id, each fetched once', async () => {
		const s = withImages();
		const base = await posters(s);
		const dune = 'https://img.example/dune.jpg';

		const added = (await s.call('add_rows', {
			base,
			table: 'Movies',
			rows: [
				{ Title: 'Dune', Poster: dune },
				{ Title: 'Dune again', Poster: [dune, 'receipt.jpg', 'd'.repeat(64)] }
			]
		})) as { added: string[] };

		expect(s.fetched).toEqual([dune]);
		const poster = s.ctx.ws.fields(s.ctx.ws.tables(base)[0].id)[1].id;
		expect(s.ctx.ws.live(added.added[0])?.data[poster]).toEqual([ref('a', dune)]);
		expect(s.ctx.ws.live(added.added[1])?.data[poster]).toEqual([
			ref('a', dune),
			{ ...ref('c'), name: 'receipt.jpg' },
			ref('d')
		]);
	});

	it('writes nothing when one link fails, and says which', async () => {
		const s = withImages();
		const base = await posters(s);
		const before = s.actions.length;

		expect(
			await s.call('add_rows', {
				base,
				table: 'Movies',
				rows: [
					{ Poster: 'https://img.example/dune.jpg' },
					{ Poster: 'https://img.example/gone.jpg' }
				]
			})
		).toEqual({
			error:
				'rows[1]."Poster": https://img.example/gone.jpg was not stored: it answered with an error; nothing was written'
		});
		expect(
			await s.call('add_rows', { base, table: 'Movies', rows: [{ Poster: 'a poster' }] })
		).toEqual({ error: expect.stringContaining('"a poster" is not an image') });
		expect(s.actions.length).toBe(before);
	});

	it('refuses images where no host stores them', async () => {
		const s = withImages();
		const base = await posters(s);
		s.ctx.images = undefined;

		expect(
			await s.call('add_rows', {
				base,
				table: 'Movies',
				rows: [{ Poster: 'https://img.example/dune.jpg' }]
			})
		).toEqual({ error: 'images cannot be added from here' });
	});

	it('turns a column of links into images, a failed one lost', async () => {
		const s = withImages();
		await s.call('create_table', {
			name: 'Movies',
			fields: [{ name: 'Poster', type: 'url' }]
		});
		const base = s.ctx.ws.bases()[0].id;
		await s.call('add_rows', {
			base,
			table: 'Movies',
			rows: [
				{ Poster: 'https://img.example/alien.jpg' },
				{ Poster: 'https://img.example/gone.jpg' }
			]
		});

		expect(
			await s.call('update_field', { base, table: 'Movies', field: 'Poster', type: 'image' })
		).toEqual({ updated: expect.any(String), lost: 1 });
		const table = s.ctx.ws.tables(base)[0].id;
		const field = s.ctx.ws.fields(table)[0].id;
		expect(s.ctx.ws.rows(table).map((row) => row.data[field] ?? null)).toEqual([
			[ref('b', 'https://img.example/alien.jpg')],
			null
		]);
	});
});
