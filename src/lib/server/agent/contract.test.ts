import { describe, expect, it } from 'vitest';

import { updateRecord } from '../../core/actions.ts';
import type { Gym } from './tools.fixture.test.ts';
import { gym } from './tools.fixture.test.ts';
import { TOOLS } from './toolkit.ts';

const SHEETS = {
	f_csv: {
		kind: 'table' as const,
		name: 'Weigh-ins.csv',
		rows: [
			['Date', 'Kg'],
			['2026-11-15', '81.4']
		]
	}
};

type Contract = {
	/** A call that succeeds on the gym fixture. */
	valid(g: Gym): Record<string, unknown>;
	/** What the valid call left behind, beyond its result fitting the output schema. */
	check?(g: Gym, result: Record<string, unknown>): void;
	/** Calls refused, each with what the refusal says. */
	refused: [(g: Gym) => Record<string, unknown>, RegExp][];
	/** Actions a valid call records; a write tool records one unless the server writes alone. */
	actions?: number;
};

const CONTRACTS: Record<string, Contract> = {
	list_bases: {
		valid: () => ({}),
		check: (_, result) =>
			expect(result).toEqual({
				bases: [
					{
						id: expect.any(String),
						name: 'Gym',
						tables: [
							{ id: expect.any(String), name: 'Exercises', rows: 1 },
							{ id: expect.any(String), name: 'Sets', rows: 1 }
						]
					}
				]
			}),
		refused: []
	},
	describe_base: {
		valid: () => ({ base: 'gym' }),
		check: (_, result) => {
			const sets = (result.tables as { name: string; fields: unknown[]; views: unknown[] }[])[1];
			expect(sets.fields).toContainEqual({
				id: expect.any(String),
				name: 'Exercise',
				type: 'link',
				target: 'Exercises'
			});
			expect(sets.fields).toContainEqual({
				id: expect.any(String),
				name: 'Weight',
				type: 'number',
				unit: 'kg'
			});
		},
		refused: [[() => ({ base: 'Nope' }), /^no base "Nope"; the bases are "Gym"$/u]]
	},
	query: {
		valid: () => ({ base: 'Gym', sql: 'select "Exercise", "Weight" from "Sets"' }),
		check: (_, result) =>
			expect(result).toEqual({
				columns: ['Exercise', 'Weight'],
				rows: [['Bench', 80]],
				next: null,
				cut: 0
			}),
		refused: [
			[() => ({ base: 'Gym', sql: 'select nope from "Sets"' }), /no such column: nope/u],
			[() => ({ base: 'Gym', sql: 'delete from "Sets"' }), /syntax error/u],
			[() => ({ base: 'Gym', sql: 'select 1; select 2' }), /^one statement at a time$/u],
			[() => ({ base: 'Gym', sql: 'select 1', offset: -1 }), /^offset: /u]
		]
	},
	add_rows: {
		valid: () => ({
			base: 'Gym',
			table: 'Sets',
			rows: [{ Date: '2026-11-16', Exercise: 'Bench', Weight: 82.5, Reps: 6, Side: 'Both' }]
		}),
		check: (g, result) => {
			const [id] = result.added as string[];
			expect(g.ctx.ws.live(id)?.parent).toBe(g.sets);
			const side = g.ctx.ws.fields(g.sets).find((field) => field.name === 'Side');
			expect(side?.choices.map((choice) => choice.name)).toEqual(['Left', 'Right', 'Both']);
		},
		refused: [
			[
				() => ({ base: 'Gym', table: 'Sets', rows: [{ Weight: 'heavy' }] }),
				/^rows\[0\]\."Weight": "heavy" is not a number; nothing was written$/u
			],
			[
				() => ({ base: 'Gym', table: 'Sets', rows: [{ Weigth: 80 }] }),
				/^no field "Weigth" in Sets; the fields are "Date", "Exercise", "Weight"/u
			],
			[
				() => ({ base: 'Gym', table: 'Sets', rows: [{ Exercise: 'Squat' }] }),
				/^no row "Squat" in Exercises, which "Exercise" links to$/u
			],
			[() => ({ base: 'Gym', table: 'Sets', rows: [] }), /^rows: /u]
		]
	},
	update_rows: {
		valid: (g) => ({ base: 'Gym', table: 'Sets', updates: [{ id: g.row, values: { Reps: 9 } }] }),
		check: (g) => expect(g.ctx.ws.live(g.row)?.data).toMatchObject({ [repsOf(g)]: 9 }),
		refused: [
			[
				(g) => ({
					base: 'Gym',
					table: 'Sets',
					updates: [{ id: g.weight, values: { Reps: 9 } }]
				}),
				/is a field, not a row of Sets/u
			],
			[
				(g) => ({
					base: 'Gym',
					table: 'Sets',
					updates: [{ id: g.row, values: { Done: 'maybe' } }]
				}),
				/^updates\[0\]\.values\."Done": "maybe" is not a check/u
			]
		]
	},
	delete_rows: {
		valid: (g) => ({ base: 'Gym', table: 'Sets', ids: [g.row, g.row] }),
		check: (g, result) => {
			expect(result).toEqual({ deleted: 1 });
			expect(g.ctx.ws.live(g.row)).toBeUndefined();
		},
		refused: [
			[(g) => ({ base: 'Gym', table: 'Sets', ids: [g.grid] }), /is a view, not a row of Sets/u],
			[(g) => ({ base: 'Gym', table: 'Exercises', ids: [g.row] }), /^no row .* in Exercises/u]
		]
	},
	create_base: {
		valid: () => ({ name: ' Money ' }),
		check: (g, result) => expect(g.ctx.ws.base(result.id as string)?.name).toBe('Money'),
		refused: [[() => ({ name: '' }), /^name: /u]]
	},
	create_table: {
		valid: () => ({ base: 'Gym', name: 'Weigh-ins', fields: [{ name: 'Kg', type: 'number' }] }),
		check: (g, result) => {
			expect(g.ctx.ws.views(result.id as string).map((view) => view.type)).toEqual([
				'grid',
				'entry'
			]);
		},
		refused: [
			[
				() => ({ base: 'Gym', name: ' sets ', fields: [{ name: 'A', type: 'text' }] }),
				/^Gym already has a table named "Sets" \(t_\w+\); pick another name$/u
			],
			[
				() => ({
					base: 'Gym',
					name: 'Body',
					fields: [
						{ name: 'Kg', type: 'number' },
						{ name: 'kg', type: 'number' }
					]
				}),
				/^"Body" already has a field named "Kg"/u
			],
			[
				() => ({ base: 'Gym', name: 'Body', fields: [{ name: 'L', type: 'link' }] }),
				/^a link field needs target$/u
			],
			[
				() => ({ base: 'Gym', name: 'Body', fields: [{ name: 'F', type: 'formula' }] }),
				/^fields\[0\]\.type: /u
			]
		]
	},
	add_field: {
		valid: () => ({
			base: 'Gym',
			table: 'Sets',
			name: '1RM',
			type: 'formula',
			formula: '"Weight" * (1 + "Reps" / 30.0)'
		}),
		check: async (g) => {
			expect(
				await g.call('query', { base: 'Gym', sql: 'select round("1RM", 1) from "Sets"' })
			).toMatchObject({
				rows: [[101.3]]
			});
		},
		refused: [
			[
				() => ({ base: 'Gym', table: 'Sets', name: 'weight', type: 'number' }),
				/^Sets already has a field named "Weight"/u
			],
			[
				() => ({ base: 'Gym', table: 'Sets', name: 'X', type: 'formula', formula: 'nope(1)' }),
				/^SQLite refuses the formula: no such function: nope$/u
			]
		]
	},
	update_field: {
		valid: () => ({ base: 'Gym', table: 'Sets', field: 'Reps', name: 'Repetitions', decimals: 0 }),
		check: (g, result) => {
			expect(result).toEqual({ updated: expect.any(String), lost: 0 });
			expect(g.ctx.ws.field(result.updated as string)).toMatchObject({
				name: 'Repetitions',
				decimals: 0
			});
		},
		refused: [
			[
				() => ({ base: 'Gym', table: 'Sets', field: 'Reps', name: 'weight' }),
				/^Sets already has a field named "Weight"/u
			],
			[
				() => ({ base: 'Gym', table: 'Sets', field: 'Reps', formula: '1' }),
				/^"Reps" is not a computed field$/u
			]
		]
	},
	create_view: {
		valid: () => ({
			base: 'Gym',
			table: 'Sets',
			name: 'Top sets',
			type: 'chart',
			config: { kind: 'line', x: 'Date', agg: 'max', y: 'Weight', bucket: 'week' }
		}),
		check: (g, result) =>
			expect(g.ctx.ws.views(g.sets).find((view) => view.id === result.id)?.config).toMatchObject({
				kind: 'line',
				x: expect.any(String),
				agg: 'max'
			}),
		refused: [
			[
				() => ({ base: 'Gym', table: 'Sets', name: 'V', type: 'grid', config: { sorts: [] } }),
				/^config takes no "sorts"; it takes hidden, sort, filters, colors, totals, /u
			],
			[
				() => ({
					base: 'Gym',
					table: 'Sets',
					name: 'V',
					type: 'grid',
					config: { hidden: ['Nope'] }
				}),
				/^no field "Nope" in Sets/u
			]
		]
	},
	update_view: {
		valid: () => ({
			base: 'Gym',
			table: 'Sets',
			view: 'grid',
			config: {
				sort: [
					{ field: 'Date', dir: 'desc' },
					{ field: 'Reps', dir: 'asc' }
				]
			}
		}),
		check: async (g) => {
			const schema = (await g.call('describe_base', { base: 'Gym' })) as {
				tables: { views: { name: string; config: unknown }[] }[];
			};
			expect(schema.tables[1].views[0].config).toEqual({
				sort: [
					{ field: 'Date', dir: 'desc' },
					{ field: 'Reps', dir: 'asc' }
				]
			});
		},
		refused: [
			[
				() => ({ base: 'Gym', table: 'Sets', view: 'Nope' }),
				/^no view "Nope" on Sets; the views are "Grid", "Entry"$/u
			],
			[
				() => ({ base: 'Gym', table: 'Sets', view: 'Grid', config: { sort: [{ field: 'Date' }] } }),
				/^config\.sort\[0\]\.dir: /u
			]
		]
	},
	duplicate: {
		valid: () => ({ base: 'Gym', table: 'Sets', field: 'Weight' }),
		check: (g, result) =>
			expect(g.ctx.ws.field(String(result.created))).toMatchObject({
				name: 'Weight copy',
				unit: 'kg'
			}),
		refused: [
			[
				() => ({ base: 'Gym', table: 'Sets', rows: ['r_nothere000'] }),
				/^no row r_nothere000 in Sets$/u
			],
			[() => ({ base: 'Gym', table: 'Sets', name: 'exercises' }), /^Gym already has a table named/u]
		]
	},
	rename: {
		valid: (g) => ({ base: 'Gym', id: g.sets, name: 'Lifts' }),
		check: (g) => expect(g.ctx.ws.table(g.sets)?.name).toBe('Lifts'),
		refused: [
			[(g) => ({ base: 'Gym', id: g.sets, name: 'exercises' }), /^Gym already has a table named/u],
			[
				(g) => ({ base: 'Gym', id: g.weight, name: 'Load' }),
				/is a field; update_field renames fields$/u
			]
		]
	},
	delete: {
		valid: (g) => ({ base: 'Gym', id: g.grid }),
		check: (g) => expect(g.ctx.ws.live(g.grid)).toBeUndefined(),
		refused: [[(g) => ({ base: 'Gym', id: g.row }), /is a row; delete_rows deletes rows$/u]]
	},
	import_file: {
		valid: () => ({ file: 'f_csv', base: 'Gym' }),
		check: (_, result) => expect(result).toMatchObject({ rows: 1 }),
		refused: [
			[() => ({ file: 'f_none' }), /^no attached file f_none that reads as a table$/u],
			[
				() => ({ file: 'f_csv', base: 'Gym', name: 'SETS' }),
				/^Gym already has a table named "Sets"/u
			]
		]
	},
	open: {
		valid: () => ({ table: 'Sets', view: 'Entry' }),
		check: (g) => expect(g.shown.at(-1)).toMatchObject({ kind: 'open', table: g.sets }),
		refused: [[() => ({ table: 'Nope' }), /^no table "Nope"; the tables are "Exercises", "Sets"$/u]]
	},
	export: {
		valid: () => ({}),
		check: (g) => expect(g.shown.at(-1)).toEqual({ kind: 'export' }),
		refused: []
	},
	export_table: {
		valid: () => ({ table: 'Sets', view: 'Grid' }),
		check: (g) => expect(g.shown.at(-1)).toEqual({ kind: 'csv', table: g.sets, view: g.grid }),
		refused: [
			[
				() => ({ table: 'Sets', view: 'Entry' }),
				/^"Entry" is not a grid view; give a grid view or none$/u
			]
		]
	},
	move: {
		valid: () => ({ base: 'Gym', table: 'Sets', field: 'Reps', position: 1 }),
		check: (g, result) => {
			expect(result).toEqual({ moved: repsOf(g), position: 1 });
			expect(g.ctx.ws.fields(g.sets)[0].name).toBe('Reps');
		},
		refused: [
			[
				() => ({ base: 'Gym', table: 'Sets', field: 'Reps', view: 'Grid', position: 1 }),
				/^give field or view, one of them$/u
			],
			[() => ({ base: 'Gym', table: 'Sets', view: 'Grid', position: 0 }), /^position: /u]
		]
	},
	read_source: {
		valid: () => ({ url: 'https://example.com/movies.csv' }),
		check: (_, result) =>
			expect(result).toMatchObject({
				format: 'csv',
				columns: [{ path: 'Title', values: ['Alien', 'Heat'] }, { path: 'Year' }],
				rows_on_page: 2
			}),
		refused: [
			[() => ({}), /^give url, or preset and value$/u],
			[() => ({ url: 'https://example.com/docs' }), /web page, not data/u],
			[() => ({ preset: 'letterboxd', value: 'two words' }), /^letterboxd can’t read "two words"$/u]
		]
	},
	connect_source: {
		valid: () => ({ url: 'https://example.com/movies.csv', name: 'Movies' }),
		check: (g, result) => {
			expect(result).toMatchObject({ rows: 2, needs_key: false });
			expect(g.actions.at(-1)).toMatchObject({ applied: true });
			expect(g.linked.has(result.id as string)).toBe(true);
			expect(g.ctx.ws.table(result.id as string)?.name).toBe('Movies');
		},
		refused: [
			[
				() => ({ url: 'https://example.com/401.json', auth: { kind: 'bearer' } }),
				/needs a key, so its columns can’t be read here/u
			],
			[() => ({ url: 'https://example.com/movies.csv', base: 'Nope' }), /^no base "Nope"$/u],
			[
				() => ({ url: 'https://example.com/movies.csv', fields: [] }),
				/^fields needs at least one column$/u
			]
		]
	},
	refresh_source: {
		valid: (g) => ({ table: g.link('Movies') }),
		check: (_, result) => expect(result).toEqual({ added: 0, changed: 1, removed: 0 }),
		refused: [[() => ({ table: 'Sets' }), /^"Sets" is not linked to a source$/u]],
		actions: 0
	},
	update_source: {
		valid: (g) => ({ table: g.link('Movies'), every: 'day' }),
		check: (g, result) => expect(g.linked.has(result.updated as string)).toBe(true),
		refused: [
			[
				() => ({ table: 'Nope', stop: true }),
				/^no linked table "Nope"; the linked tables are none$/u
			]
		],
		actions: 0
	}
};

function repsOf(g: Gym): string {
	return g.ctx.ws.fields(g.sets).find((field) => field.name === 'Reps')?.id ?? '';
}

describe('tool contracts', () => {
	it('covers every tool', () => {
		expect(Object.keys(CONTRACTS).toSorted()).toEqual(TOOLS.map((tool) => tool.name).toSorted());
	});

	describe.each(TOOLS.map((tool) => [tool.name, tool] as const))('%s', (name, tool) => {
		const contract = CONTRACTS[name];

		it('answers a valid call in its output schema, writing only if it writes', async () => {
			const g = await gym(SHEETS);
			const before = g.actions.length;

			const outcome = await g.outcome(name, contract.valid(g));

			expect(outcome).toMatchObject({ ok: true });
			const result = outcome.ok ? outcome.result : {};
			expect(tool.output.safeParse(result).error).toBeUndefined();
			await contract.check?.(g, result);
			expect(g.actions.length - before).toBe(contract.actions ?? (tool.kind === 'write' ? 1 : 0));
		});

		it('refuses a key it does not take, naming the ones it does', async () => {
			const g = await gym(SHEETS);
			const before = g.actions.length;

			const outcome = await g.outcome(name, { ...contract.valid(g), bogus: 1 });

			const keys = Object.keys(tool.input.shape).join(', ');
			expect(outcome).toEqual({
				ok: false,
				error: keys === '' ? 'input takes no "bogus"' : `input takes no "bogus"; it takes ${keys}`
			});
			expect(g.actions).toHaveLength(before);
		});

		it.each(contract.refused.map((refusal, index) => [index, ...refusal] as const))(
			'refuses case %i and writes nothing',
			async (_, input, message) => {
				const g = await gym(SHEETS);
				const before = g.actions.length;

				const outcome = await g.outcome(name, input(g));

				expect(outcome.ok).toBe(false);
				expect(outcome.ok ? '' : outcome.error).toMatch(message);
				expect(g.actions).toHaveLength(before);
			}
		);
	});

	it('refuses an ambiguous name, listing the ids, and takes the id', async () => {
		const g = await gym();
		g.ctx.commit({
			summary: 'twin',
			changes: updateRecord(g.ctx.ws, g.exercises, { name: 'Sets' })
		});

		expect(await g.call('describe_base', { base: 'Gym' })).toMatchObject({ id: g.base });
		expect(await g.call('add_rows', { base: 'Gym', table: 'Sets', rows: [{}] })).toEqual({
			error: `"Sets" names 2 tables in Gym: ${g.exercises}, ${g.sets}; give the id`
		});
		expect(await g.call('add_rows', { base: 'Gym', table: g.sets, rows: [{}] })).toMatchObject({
			added: [expect.any(String)]
		});
	});

	it('places rows and fields where a person can, and moves a view', async () => {
		const g = await gym();
		const { added } = (await g.call('add_rows', {
			base: 'Gym',
			table: 'Sets',
			rows: [{ Reps: 1 }, { Reps: 2 }],
			before: g.row
		})) as { added: string[] };
		expect(g.ctx.ws.rows(g.sets).map((row) => row.id)).toEqual([...added, g.row]);
		const [after] = (
			(await g.call('add_rows', {
				base: 'Gym',
				table: 'Sets',
				rows: [{ Reps: 3 }],
				after: added[0]
			})) as { added: string[] }
		).added;
		expect(g.ctx.ws.rows(g.sets).map((row) => row.id)).toEqual([added[0], after, added[1], g.row]);

		await g.call('add_field', {
			base: 'Gym',
			table: 'Sets',
			name: 'RPE',
			type: 'number',
			position: 2
		});
		expect(g.ctx.ws.fields(g.sets)[1].name).toBe('RPE');

		await g.call('move', { base: 'Gym', table: 'Sets', view: 'Entry', position: 1 });
		expect(g.ctx.ws.views(g.sets).map((view) => view.name)).toEqual(['Entry', 'Grid']);
	});

	it('sets choice colours and reads them back', async () => {
		const g = await gym();
		await g.call('update_field', {
			base: 'Gym',
			table: 'Sets',
			field: 'Side',
			choices: ['Left', { name: 'Right', color: 'pink' }]
		});
		const schema = (await g.call('describe_base', { base: 'Gym' })) as {
			tables: { fields: { name: string; choices?: unknown }[] }[];
		};
		const side = schema.tables[1].fields.find((field) => field.name === 'Side');
		expect(side?.choices).toEqual([
			{ name: 'Left', color: expect.any(String) },
			{ name: 'Right', color: 'pink' }
		]);
	});

	it('clears a chart or list setting with null', async () => {
		const g = await gym();
		const { id } = (await g.call('create_view', {
			base: 'Gym',
			table: 'Sets',
			name: 'Trend',
			type: 'chart',
			config: { kind: 'line', x: 'Date', agg: 'max', y: 'Weight', color: 'Side', rolling: 7 }
		})) as { id: string };
		await g.call('update_view', {
			base: 'Gym',
			table: 'Sets',
			view: id,
			config: { color: null, rolling: null }
		});
		expect(g.ctx.ws.view(id)?.config).toMatchObject({ color: null, rolling: null, agg: 'max' });
	});

	it('refuses a formula value given to a row', async () => {
		const g = await gym();
		await g.call('add_field', {
			base: 'Gym',
			table: 'Sets',
			name: 'Volume',
			type: 'formula',
			formula: '"Weight" * "Reps"'
		});

		expect(await g.call('add_rows', { base: 'Gym', table: 'Sets', rows: [{ Volume: 3 }] })).toEqual(
			{
				error: 'rows[0]."Volume": a formula computes its value; leave it out'
			}
		);
	});
});
