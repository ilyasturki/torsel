import { PATH, SOURCE } from '../../core/access.ts';
import { createTable } from '../../core/actions.ts';
import { Hlc } from '../../core/clock.ts';
import type { Change } from '../../core/model.ts';
import { markValue } from '../../core/source.ts';
import type { Effect } from '../../core/thread.ts';
import { Workspace } from '../../core/workspace.ts';
import type { Sheet } from './files.ts';
import type { SourceHost, SourcePreview } from './source-tools.ts';
import { SourceFailure } from './source-tools.ts';
import type { Action, ToolContext } from './toolkit.ts';
import { runTool, toolNamed } from './toolkit.ts';

export type Session = {
	ctx: ToolContext;
	/** Tables the stand-in server fills from a link. */
	linked: Set<string>;
	link(name: string): string;
	actions: Action[];
	shown: Effect[];
	call(name: string, input: unknown): Promise<unknown>;
	outcome(name: string, input: unknown): ReturnType<typeof runTool>;
};

export const MOVIES: SourcePreview = {
	format: 'csv',
	url: 'https://example.com/movies.csv',
	columns: [
		{ path: 'Title', name: 'Title', type: 'text' },
		{ path: 'Year', name: 'Year', type: 'number' }
	],
	items: [
		{ Title: 'Alien', Year: '1979' },
		{ Title: 'Heat', Year: '1995' }
	],
	count: 2,
	more: false,
	rowPaths: [],
	rows: '',
	key: null
};

/** A table a source fills, as the server writes it: its mark and each field's path. */
function linkedTable(
	ws: Workspace,
	base: string,
	name: string,
	columns: SourcePreview['columns']
): { id: string; changes: Change[] } {
	const made = createTable(
		ws,
		base,
		name,
		columns.map((column) => ({ name: column.name, type: column.type })),
		() => [{ name: 'Grid', type: 'grid', config: {} }]
	);
	const changes = made.changes.map((change) => {
		if (change.id === made.id) {
			return {
				...change,
				set: {
					...change.set,
					[SOURCE]: markValue({ name: 'example.com', problem: null, at: null })
				}
			};
		}
		const at = made.fieldIds.indexOf(change.id);
		return at < 0 ? change : { ...change, set: { ...change.set, [PATH]: columns[at].path } };
	});
	return { id: made.id, changes };
}

/** Stands in for the server: links answer from fixed data, a 401 link wants a key, a docs link is a page. */
function fakeSources(ws: Workspace, linked: Set<string>): SourceHost {
	const known = (table: string): void => {
		if (!linked.has(table)) throw new SourceFailure('gone');
	};
	return {
		preview: ({ url }) => {
			if (url.includes('401')) return Promise.reject(new SourceFailure('auth'));
			if (url.includes('docs')) return Promise.reject(new SourceFailure('html'));
			return Promise.resolve({ ...MOVIES, url });
		},
		connect: (request) => {
			const base = request.base ?? ws.bases()[0].id;
			const made = linkedTable(ws, base, request.name, request.columns);
			linked.add(made.id);
			return Promise.resolve({
				table: made.id,
				base,
				changes: made.changes,
				run: { ok: true, added: 2, changed: 0, removed: 0, problem: null }
			});
		},
		refresh: (table) => {
			known(table);
			return Promise.resolve({ ok: true, added: 0, changed: 1, removed: 0, problem: null });
		},
		update: (table, patch) => {
			known(table);
			return Promise.resolve(
				patch.url === undefined
					? null
					: { ok: true, added: 0, changed: 1, removed: 0, problem: null }
			);
		},
		stop: (table) => {
			known(table);
			linked.delete(table);
			return Promise.resolve();
		}
	};
}

export function session(sheets: Record<string, Sheet> = {}): Session {
	const ws = new Workspace();
	const hlc = new Hlc('ai');
	const actions: Action[] = [];
	const shown: Effect[] = [];
	const linked = new Set<string>();
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
		sheet: (file) => sheets[file] ?? null,
		sources: fakeSources(ws, linked)
	};

	// Straight into the workspace, as a sync would bring it: no action of the session's.
	const link = (name: string): string => {
		const made = linkedTable(ws, ws.bases()[0].id, name, MOVIES.columns);
		for (const change of made.changes) ws.stamp(change, hlc.tick());
		linked.add(made.id);
		return made.id;
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

	return { ctx, linked, link, actions, shown, call, outcome };
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
