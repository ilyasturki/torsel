import { describe, expect, it } from 'vitest';

import { Hlc } from '../../core/clock.ts';
import { Workspace } from '../../core/workspace.ts';
import type { Effect } from '../../core/thread.ts';
import type { Sheet } from './files.ts';
import type { Action, ToolContext } from './toolkit.ts';
import { closeEngines, runTool, toolNamed } from './toolkit.ts';

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
