import type Anthropic from '@anthropic-ai/sdk';

import type { Change } from './model.ts';

export const MAX_PROMPT = 4000;

export const MAX_CONTEXT_ROWS = 200;

export type Tier = 'apply' | 'propose' | 'confirm';

export type ActionStatus = 'pending' | 'applied' | 'rejected' | 'undone';

export type ThreadAction = {
	id: string;
	tier: Tier;
	summary: string;
	detail: string[];
	changes: Change[];
	after: string[];
	status: ActionStatus;
};

export type ThreadContext = {
	base: string | null;
	table: string | null;
	view: string | null;
	rows: string[];
};

export type RowMeta = { prompt: string; where: string } | null;

export type EventKind = 'stopped' | 'declined' | 'error';

export type EventContent = { kind: EventKind; message: string; excludes?: number };

export type ThreadRow = {
	seq: number;
	role: 'user' | 'assistant' | 'event';
	content: unknown;
	meta: RowMeta;
};

export type ThreadSummary = { id: string; title: string; updatedAt: number };

export type TurnEvent =
	| { type: 'ping' }
	| { type: 'assistant' }
	| { type: 'block'; index: number; block: { type: string; id?: string; name?: string } }
	| { type: 'text'; index: number; text: string }
	| { type: 'note'; index: number; text: string }
	| { type: 'input'; index: number; input: unknown }
	| {
			type: 'result';
			id: string;
			isError: boolean;
			content: string;
			action: ThreadAction | null;
	  }
	| { type: 'event'; event: EventContent }
	| { type: 'done' };

export const TOOL_TITLES: Record<string, string> = {
	list_bases: 'List bases',
	describe_base: 'Read the schema',
	query: 'Read with SQL',
	add_rows: 'Add rows',
	update_rows: 'Change rows',
	delete_rows: 'Delete rows',
	create_base: 'Create a base',
	create_table: 'Create a table',
	add_field: 'Add a field',
	update_field: 'Change a field',
	create_view: 'Create a view',
	delete: 'Delete a table, field or view'
};

export type Item =
	| { kind: 'user'; key: string; text: string; where: string }
	| { kind: 'note'; key: string; text: string }
	| { kind: 'text'; key: string; text: string }
	| {
			kind: 'tool';
			key: string;
			name: string;
			label: string;
			state: 'running' | 'done' | 'error';
			input: unknown;
			output: string | null;
			action: ThreadAction | null;
	  }
	| { kind: 'event'; key: string; event: EventKind; message: string };

// What the API sends in place of a progress note it could not finish; not meant for the person.
const INTERRUPTED = 'This part of the response was interrupted before it finished.';

type Block = Anthropic.Beta.BetaContentBlockParam;

function blocks(content: unknown): Block[] {
	return Array.isArray(content) ? (content as Block[]) : [];
}

function plural(count: number, one: string): string {
	return `${count} ${one}${count === 1 ? '' : 's'}`;
}

function parsed(output: string | null): Record<string, unknown> {
	try {
		const value: unknown = JSON.parse(output ?? '');
		return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

/** What a tool call did and on what, in one line. */
export function describeCall(
	name: string,
	output: string | null,
	action: ThreadAction | null
): string {
	const title = TOOL_TITLES[name] ?? name;
	if (action !== null) {
		return action.summary;
	}
	if (output === null) {
		return title;
	}

	const result = parsed(output);
	if (typeof result.error === 'string') {
		return title;
	}
	if (name === 'query' && typeof result.count === 'number') {
		return `${title}: ${plural(result.count, 'row')}`;
	}
	if (name === 'describe_base' && typeof result.name === 'string') {
		return `${title} of ${result.name}`;
	}
	if (name === 'list_bases' && Array.isArray(result)) {
		return `${title}: ${result.length}`;
	}
	return title;
}

export function errorOf(output: string | null): string | null {
	const error = parsed(output).error;
	return typeof error === 'string' ? error : null;
}

/** One rendering for a loaded thread and a streaming one: both are the same rows. */
export function toItems(rows: ThreadRow[], actions: ThreadAction[]): Item[] {
	const items: Item[] = [];
	const results = new Map<string, { output: string; isError: boolean }>();

	for (const row of rows) {
		if (row.role !== 'user') continue;
		for (const block of blocks(row.content)) {
			if (block.type === 'tool_result') {
				results.set(block.tool_use_id, {
					output: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
					isError: block.is_error === true
				});
			}
		}
	}

	rows.forEach((row, at) => {
		if (row.role === 'event') {
			const event = row.content as EventContent;
			items.push({ kind: 'event', key: `${at}`, event: event.kind, message: event.message });
		} else if (row.role === 'user') {
			if (row.meta !== null) {
				items.push({ kind: 'user', key: `${at}`, text: row.meta.prompt, where: row.meta.where });
			}
		} else {
			blocks(row.content).forEach((block, index) => {
				const key = `${at}.${index}`;
				if (block === undefined) return;
				if (block.type === 'text' && block.text !== '') {
					items.push({ kind: 'text', key, text: block.text });
				} else if (block.type === 'thinking') {
					if (block.thinking !== '' && block.thinking !== INTERRUPTED) {
						items.push({ kind: 'note', key, text: block.thinking });
					}
				} else if (block.type === 'tool_use') {
					const result = results.get(block.id);
					const action = actions.find((candidate) => candidate.id === block.id) ?? null;
					const output = result?.output ?? null;
					items.push({
						kind: 'tool',
						key: block.id,
						name: block.name,
						label: describeCall(block.name, output, action),
						state: result === undefined ? 'running' : result.isError ? 'error' : 'done',
						input: block.input,
						output,
						action
					});
				}
			});
		}
	});

	return items;
}

/** Past the last fallback block is what ran: what comes before it was declined with its model. */
export function afterFallback<T extends { type: string }>(content: T[]): T[] {
	const boundary = content.findLastIndex((block) => block.type === 'fallback');
	return boundary === -1 ? content : content.slice(boundary + 1);
}

/** The API's rule for sending back a turn that fell back mid-output. */
export function echoable<T extends { type: string }>(content: T[]): T[] {
	const boundary = content.findLastIndex((block) => block.type === 'fallback');
	return boundary === -1
		? content
		: content.filter(
				(block, index) =>
					index >= boundary || !['thinking', 'redacted_thinking', 'tool_use'].includes(block.type)
			);
}

/** Actions a decision on `id` carries with it: those built on it, however indirectly. */
export function dependents(actions: ThreadAction[], id: string): ThreadAction[] {
	const found = new Set([id]);
	for (const action of actions) {
		if (action.after.some((dep) => found.has(dep))) {
			found.add(action.id);
		}
	}
	found.delete(id);
	return actions.filter((action) => found.has(action.id));
}

/** Still-pending actions `id` is built on, the ones furthest back first. */
export function prerequisites(actions: ThreadAction[], id: string): ThreadAction[] {
	const needed = new Set<string>();
	const visit = (actionId: string): void => {
		const action = actions.find((candidate) => candidate.id === actionId);
		for (const dep of action?.after ?? []) {
			if (!needed.has(dep)) {
				needed.add(dep);
				visit(dep);
			}
		}
	};
	visit(id);
	return actions.filter((action) => needed.has(action.id) && action.status === 'pending');
}
