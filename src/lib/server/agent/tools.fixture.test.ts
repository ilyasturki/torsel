import { Hlc } from '../../core/clock.ts';
import type { Effect } from '../../core/thread.ts';
import { Workspace } from '../../core/workspace.ts';
import type { Sheet } from './files.ts';
import type { Action, ToolContext } from './toolkit.ts';
import { runTool, toolNamed } from './toolkit.ts';

export type Session = {
	ctx: ToolContext;
	actions: Action[];
	shown: Effect[];
	call(name: string, input: unknown): Promise<unknown>;
	outcome(name: string, input: unknown): ReturnType<typeof runTool>;
};

export function session(sheets: Record<string, Sheet> = {}): Session {
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

	const outcome = (name: string, input: unknown): ReturnType<typeof runTool> => {
		const tool = toolNamed(name);
		if (tool === undefined) throw new Error(name);
		return runTool(ctx, tool, input);
	};
	const call = async (name: string, input: unknown): Promise<unknown> => {
		const result = await outcome(name, input);
		return result.ok ? result.result : { error: result.error };
	};

	return { ctx, actions, shown, call, outcome };
}

export type Gym = Session & {
	base: string;
	sets: string;
	exercises: string;
	row: string;
	bench: string;
	grid: string;
	weight: string;
};

/** A base as kilorep's: sets that link to exercises, one of each, through the tools themselves. */
export async function gym(sheets: Record<string, Sheet> = {}): Promise<Gym> {
	const s = session(sheets);
	const { id: base } = (await s.call('create_base', { name: 'Gym' })) as { id: string };
	const { id: exercises } = (await s.call('create_table', {
		base,
		name: 'Exercises',
		fields: [{ name: 'Name', type: 'text' }]
	})) as { id: string };
	const { id: sets } = (await s.call('create_table', {
		base,
		name: 'Sets',
		fields: [
			{ name: 'Date', type: 'date' },
			{ name: 'Exercise', type: 'link', target: 'Exercises' },
			{ name: 'Weight', type: 'number', unit: 'kg' },
			{ name: 'Reps', type: 'number' },
			{ name: 'Side', type: 'choice', choices: ['Left', 'Right'] },
			{ name: 'Done', type: 'check' },
			{ name: 'Note', type: 'text' }
		]
	})) as { id: string };
	const {
		added: [bench]
	} = (await s.call('add_rows', {
		base,
		table: 'Exercises',
		rows: [{ Name: 'Bench' }]
	})) as { added: string[] };
	const {
		added: [row]
	} = (await s.call('add_rows', {
		base,
		table: 'Sets',
		rows: [{ Date: '2026-11-15', Exercise: 'Bench', Weight: 80, Reps: 8, Done: true }]
	})) as { added: string[] };

	const grid = s.ctx.ws.views(sets).find((view) => view.type === 'grid')?.id ?? '';
	const weight = s.ctx.ws.fields(sets).find((field) => field.name === 'Weight')?.id ?? '';
	return { ...s, base, sets, exercises, row, bench, grid, weight };
}
