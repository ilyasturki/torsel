import { describe, expect, it } from 'vitest';

import { Hlc } from '../../core/clock.ts';
import { Workspace } from '../../core/workspace.ts';
import type { Action, ToolContext } from './toolkit.ts';
import { closeEngines, runTool, toolNamed } from './toolkit.ts';

function session(): {
	ctx: ToolContext;
	actions: Action[];
	call: (name: string, input: unknown) => Promise<unknown>;
} {
	const ws = new Workspace();
	const hlc = new Hlc('ai');
	const actions: Action[] = [];
	const ctx: ToolContext = {
		ws,
		commit(action) {
			for (const change of action.changes) {
				ws.stamp(change, hlc.tick());
			}
			actions.push(action);
		}
	};

	const call = async (name: string, input: unknown): Promise<unknown> => {
		const tool = toolNamed(name);
		if (tool === undefined) throw new Error(name);
		const outcome = await runTool(ctx, tool, input);
		return outcome.ok ? outcome.result : { error: outcome.error };
	};

	return { ctx, actions, call };
}

describe('assistant tools', () => {
	it('tiers what it writes and reads back its own changes', async () => {
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
		expect(actions.map((action) => action.tier)).toEqual(['propose', 'propose']);

		const added = await call('add_rows', {
			base: 'Muscu',
			table: 'Séries',
			rows: [
				{ Date: '2026-10-29', Exercice: 'bench press', Poids: 80, Reps: 8 },
				{ Date: '2026-10-29', Exercice: 'squat', Poids: '100,5', Reps: 5 }
			]
		});
		expect(added).toHaveProperty('added');
		expect(actions[2].tier).toBe('apply');
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
		expect(actions.at(-1)?.tier).toBe('confirm');

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

		expect(actions.map((action) => action.tier)).toEqual(['propose', 'propose']);
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
});
