import { describe, expect, it, vi } from 'vitest';

import { Hlc } from '../../core/clock.ts';
import { Workspace } from '../../core/workspace.ts';
import type { Effect } from '../../core/thread.ts';
import { inLocale, requestLocale } from '../http/locale.ts';
import type { Sheet } from './files.ts';
import type { Action, ToolContext } from './toolkit.ts';
import { closeEngines, runTool, toolNamed } from './toolkit.ts';

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
		})) as { rows: { Exercice: string; '1RM estimé': number; _id: string }[] };
		expect(rows.rows.map((row) => [row.Exercice, row['1RM estimé']])).toEqual([
			['bench press', 101.3],
			['squat', 117.3]
		]);

		await call('delete_rows', { base: 'Muscu', table: 'Séries', ids: [rows.rows[1]._id] });
		expect(actions.at(-1)?.summary).toBe('Delete 1 row from Séries');

		closeEngines(ctx.ws);
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
		closeEngines(ctx.ws);
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
		closeEngines(ctx.ws);
	});

	it('answers a bad name with the way to find the right one', async () => {
		const { call } = session();

		expect(await call('describe_base', { base: 'Nulle part' })).toEqual({
			error: expect.stringMatching(/list_bases/u)
		});
		expect(await call('add_rows', { base: 'x' })).toEqual({ error: expect.any(String) });
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
			config: { sort: { field: 'Rating', dir: 'desc' } }
		});
		const rating = ctx.ws.fields(made.id)[1].id;
		expect(ctx.ws.view(grid.id)?.config.sort).toEqual({ field: rating, dir: 'desc' });

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
		closeEngines(ctx.ws);
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
		expect(query.rows).toEqual([{ n: 1 }]);
	});
});

describe('query limits', () => {
	it('stops a runaway query at its deadline', async () => {
		const { call, ctx } = session();
		await call('create_base', { name: 'B' });

		const started = Date.now();
		const answer = await call('query', {
			base: 'B',
			sql: 'with recursive c(x) as (select 1 union all select x + 1 from c) select count(*) from c'
		});

		expect(answer).toEqual({ error: expect.stringMatching(/ran past 500 ms/u) });
		expect(Date.now() - started).toBeLessThan(1500);
		closeEngines(ctx.ws);
	});

	it('refuses a value too long to hold', async () => {
		const { call, ctx } = session();
		await call('create_base', { name: 'B' });

		expect(
			await call('query', { base: 'B', sql: `select printf('%.*c', 100000000, 'x') as v` })
		).toEqual({ error: expect.stringMatching(/too big/u) });
		closeEngines(ctx.ws);
	});

	it('caps the answer by size and says so', async () => {
		const { call, ctx } = session();
		await call('create_base', { name: 'B' });

		const big = (await call('query', {
			base: 'B',
			sql: `with recursive c(x) as (select 1 union all select x + 1 from c where x < 150) select x, printf('%.*c', 2000, 'x') as pad from c`
		})) as { rows: unknown[]; count: number; truncated: boolean };
		expect(big.truncated).toBe(true);
		expect(big.count).toBe(big.rows.length);
		expect(JSON.stringify(big.rows).length).toBeLessThan(70_000);

		const many = (await call('query', {
			base: 'B',
			sql: 'with recursive c(x) as (select 1 union all select x + 1 from c where x < 300) select x from c'
		})) as { count: number; truncated: boolean };
		expect(many).toMatchObject({ count: 200, truncated: true });

		const small = await call('query', { base: 'B', sql: 'select 1 as x' });
		expect(small).toEqual({ rows: [{ x: 1 }], count: 1, truncated: false });
		closeEngines(ctx.ws);
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
		closeEngines(ctx.ws);
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
			expect(await call('delete_rows', { base, table: 'Movies', ids: [id] })).toEqual({
				error: `no row ${id} in Movies`
			});
			expect(
				await call('update_rows', {
					base,
					table: 'Movies',
					updates: [{ id, values: { Title: 'x' } }]
				})
			).toEqual({ error: `no row ${id} in Movies` });
		}

		expect(actions).toHaveLength(before);
		expect(ctx.ws.live(field)).toBeDefined();
		expect(ctx.ws.live(view)).toBeDefined();
		closeEngines(ctx.ws);
	});

	it.each([
		['Watched', 'last tuesday', /"Watched": "last tuesday" is not a date \(YYYY-MM-DD\)/u],
		['Rating', 'eight', /"Rating": "eight" is not a rating/u],
		['Rating', 9, /"Rating": 9 is not a rating from 1 to 5/u],
		['Year', 'MMXXI', /"Year": "MMXXI" is not a number/u],
		['Title', true, /"Title": true is not text/u],
		['Favorite', 'maybe', /"Favorite": "maybe" is not a check \(true or false\)/u],
		['Genre', { name: 'Drama' }, /"Genre": \{"name":"Drama"\} is not a choice/u]
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
		closeEngines(ctx.ws);
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
		closeEngines(ctx.ws);
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
		closeEngines(ctx.ws);
	});
});
