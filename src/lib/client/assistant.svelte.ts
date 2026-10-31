import { SvelteSet } from 'svelte/reactivity';

import type { Change, FieldDef, Value, ViewDef } from '../core/model.ts';
import { DELETED } from '../core/model.ts';
import type {
	EventKind,
	ThreadAction,
	ThreadContext,
	ThreadRow,
	ThreadSummary,
	TurnEvent
} from '../core/thread.ts';
import { dependents, prerequisites } from '../core/thread.ts';
import { fieldDef, viewDef } from '../core/workspace.ts';
import { ApiError, NO_SERVER, OFFLINE, apiBase, request, streamLines } from './api.ts';
import { app } from './app.svelte.ts';
import { syncNow } from './sync.svelte.ts';
import { showToast } from './toast.svelte.ts';

type LiveBlock = { type: string; text?: string; thinking?: string; input?: unknown };

export const assistant = $state({
	available: null as boolean | null,
	id: null as string | null,
	title: '',
	rows: [] as ThreadRow[],
	actions: [] as ThreadAction[],
	threads: [] as ThreadSummary[],
	listing: false,
	busy: false
});

/** Rows the assistant just wrote, standing out in place for a moment. */
export const fresh = new SvelteSet<string>();

const FRESH_MS = 3000;

const THREAD_META = 'thread';

let controller: AbortController | null = null;

// Undo groups live in memory, so an action applied before a reload can no longer be undone.
const groups = new Map<string, number>();

const queued = new Map<string, ThreadAction['status']>();

let flushing: Promise<void> = Promise.resolve();

function flushDecisions(): Promise<void> {
	flushing = flushing.then(async () => {
		if (queued.size === 0 || assistant.id === null) {
			return;
		}
		const decisions = [...queued].map(([id, status]) => ({ id, status }));
		queued.clear();
		try {
			await request(`/api/ai/threads/${assistant.id}/decisions`, {
				method: 'POST',
				body: { decisions }
			});
		} catch {
			for (const { id, status } of decisions) {
				if (!queued.has(id)) queued.set(id, status);
			}
		}
	});
	return flushing;
}

function decide(action: ThreadAction, status: ThreadAction['status']): void {
	action.status = status;
	queued.set(action.id, status);
	void flushDecisions();
}

export function markFresh(action: ThreadAction): void {
	const rows = action.changes.filter((change) => change.kind === 'row').map((change) => change.id);
	for (const id of rows) {
		fresh.add(id);
	}
	setTimeout(() => {
		for (const id of rows) {
			fresh.delete(id);
		}
	}, FRESH_MS);
}

/** After a reload whose decision never reached the server, applying again would overwrite later edits. */
function alreadyApplied(action: ThreadAction): boolean {
	return action.changes.every((change) => {
		const rec = app.ws.get(change.id);
		return (
			rec !== undefined &&
			Object.entries(change.set).every(
				([key, value]) => JSON.stringify(rec.data[key] ?? null) === JSON.stringify(value)
			)
		);
	});
}

function applyAction(action: ThreadAction): void {
	if (alreadyApplied(action)) {
		decide(action, 'applied');
		return;
	}
	// IndexedDB can't clone a state proxy; the cast stops `snapshot` recursing through `Value`.
	const changes = $state.snapshot(action.changes as unknown[]) as Change[];
	const group = app.apply(changes, action.summary, 'ai');
	if (group !== null) {
		groups.set(action.id, group.id);
	}
	decide(action, 'applied');
	markFresh(action);
	showToast(`Applied: ${action.summary}`, group?.id ?? null);
}

/** Applies data entry nothing holds back, in the order it came. */
function settle(): void {
	for (const action of assistant.actions) {
		if (
			action.status === 'pending' &&
			action.tier === 'apply' &&
			action.after.every(
				(dep) => assistant.actions.find((other) => other.id === dep)?.status !== 'pending'
			)
		) {
			applyAction(action);
		}
	}
}

export function accept(id: string): void {
	const action = assistant.actions.find((candidate) => candidate.id === id);
	if (action?.status !== 'pending') return;
	for (const needed of prerequisites(assistant.actions, id)) {
		applyAction(needed);
	}
	applyAction(action);
	settle();
}

export function reject(id: string): void {
	const action = assistant.actions.find((candidate) => candidate.id === id);
	if (action?.status !== 'pending') return;
	decide(action, 'rejected');
	for (const built of dependents(assistant.actions, id)) {
		if (built.status === 'pending') {
			decide(built, 'rejected');
		}
	}
}

export function acceptAll(): void {
	for (const action of assistant.actions) {
		if (action.tier === 'propose') {
			accept(action.id);
		}
	}
}

export function canUndo(action: ThreadAction): boolean {
	const group = groups.get(action.id);
	return (
		action.status === 'applied' &&
		group !== undefined &&
		app.history.some((item) => item.id === group)
	);
}

export function undoAction(action: ThreadAction): void {
	const group = groups.get(action.id);
	if (group !== undefined) {
		app.undo(group);
		showToast(`Undid: ${action.summary}`);
	}
}

app.onUndo = (group) => {
	for (const action of assistant.actions) {
		if (groups.get(action.id) === group.id) {
			decide(action, 'undone');
		}
	}
};

function pushEvent(kind: EventKind, message: string): void {
	assistant.rows.push({ seq: 0, role: 'event', content: { kind, message }, meta: null });
}

function blocksOf(row: ThreadRow | undefined): LiveBlock[] {
	return row?.content as LiveBlock[];
}

function onEvent(event: TurnEvent): void {
	const rows = assistant.rows;
	const live = rows.findLast((row) => row.role === 'assistant');

	switch (event.type) {
		case 'assistant':
			rows.push({ seq: 0, role: 'assistant', content: [], meta: null });
			break;
		case 'block':
			blocksOf(live)[event.index] =
				event.block.type === 'text'
					? { type: 'text', text: '' }
					: event.block.type === 'thinking'
						? { type: 'thinking', thinking: '' }
						: event.block.type === 'tool_use'
							? { ...event.block, input: {} }
							: event.block;
			break;
		case 'text':
			blocksOf(live)[event.index].text += event.text;
			break;
		case 'note':
			blocksOf(live)[event.index].thinking += event.text;
			break;
		case 'input':
			blocksOf(live)[event.index].input = event.input;
			break;
		case 'result': {
			rows.push({
				seq: 0,
				role: 'user',
				content: [
					{
						type: 'tool_result',
						tool_use_id: event.id,
						is_error: event.isError,
						content: event.content
					}
				],
				meta: null
			});
			if (event.action !== null) {
				assistant.actions.push(event.action);
				settle();
			}
			break;
		}
		case 'event':
			pushEvent(event.event.kind, event.event.message);
			break;
		default:
			break;
	}
}

function problemOf(error: unknown): string {
	if (error instanceof ApiError) {
		return error.status === OFFLINE || error.status === NO_SERVER
			? 'The assistant needs a connection to the server.'
			: error.message;
	}
	return 'Something went wrong. Try again.';
}

export async function send(prompt: string, context: ThreadContext, where: string): Promise<void> {
	if (assistant.busy) return;
	assistant.busy = true;
	assistant.listing = false;
	controller = new AbortController();
	const { signal } = controller;
	assistant.rows.push({ seq: 0, role: 'user', content: [], meta: { prompt, where } });

	try {
		await flushDecisions();
		await syncNow();
		if (assistant.id === null) {
			const thread = await request<ThreadSummary>('/api/ai/threads', {
				method: 'POST',
				body: { prompt }
			});
			assistant.id = thread.id;
			assistant.title = thread.title;
			void app.setMeta(THREAD_META, thread.id);
		}
		await streamLines<TurnEvent>(
			`/api/ai/threads/${assistant.id}/messages`,
			{ body: { prompt, context }, signal },
			onEvent
		);
	} catch (error) {
		if (signal.aborted) {
			pushEvent('stopped', 'Stopped.');
		} else {
			pushEvent('error', problemOf(error));
		}
	} finally {
		assistant.busy = false;
		controller = null;
	}
}

export function stop(): void {
	controller?.abort();
}

export async function openThread(id: string): Promise<void> {
	await flushDecisions();
	const thread = await request<ThreadSummary & { rows: ThreadRow[]; actions: ThreadAction[] }>(
		`/api/ai/threads/${id}`
	);
	assistant.id = thread.id;
	assistant.title = thread.title;
	assistant.rows = thread.rows;
	assistant.actions = thread.actions;
	assistant.listing = false;
	void app.setMeta(THREAD_META, thread.id);
	settle();
}

export function newThread(): void {
	stop();
	void flushDecisions();
	assistant.id = null;
	assistant.title = '';
	assistant.rows = [];
	assistant.actions = [];
	assistant.listing = false;
	void app.setMeta(THREAD_META, null);
}

export async function showThreads(): Promise<void> {
	assistant.listing = !assistant.listing;
	if (assistant.listing) {
		assistant.threads = await request<ThreadSummary[]>('/api/ai/threads').catch(
			() => assistant.threads
		);
	}
}

/** The last thread comes back with the app, so its proposals keep showing in the tables. */
export async function resumeThread(): Promise<void> {
	if (assistant.id !== null) return;
	const id = await app.meta<string | null>(THREAD_META);
	if (id) {
		await openThread(id).catch(() => app.setMeta(THREAD_META, null));
	}
}

/** Whether this server can run the assistant; an unreachable server leaves the last answer standing. */
export async function checkAvailability(): Promise<void> {
	if (apiBase() === null) {
		assistant.available = false;
		return;
	}
	try {
		const health = await request<{ assistant?: boolean }>('/api/health');
		assistant.available = health.assistant === true;
	} catch {
		assistant.available ??= false;
	}
}

export type GhostField = { field: FieldDef; action: ThreadAction };

export type GhostView = { view: ViewDef; action: ThreadAction };

function ghostRec(change: ThreadAction['changes'][number]) {
	return {
		id: change.id,
		kind: change.kind,
		base: change.base,
		parent: change.parent,
		data: change.set,
		clocks: {}
	};
}

function waiting(): ThreadAction[] {
	return assistant.actions.filter(
		(action) => action.status === 'pending' && action.tier === 'propose'
	);
}

/** Proposed fields of a table, drawn in place: none of them is in the workspace yet. */
export function ghostFields(tableId: string): GhostField[] {
	return waiting().flatMap((action) =>
		action.changes
			.filter(
				(change) =>
					change.kind === 'field' &&
					change.parent === tableId &&
					app.ws.get(change.id) === undefined
			)
			.map((change) => ({ field: fieldDef(ghostRec(change)), action }))
	);
}

export function ghostViews(tableId: string): GhostView[] {
	return waiting().flatMap((action) =>
		action.changes
			.filter(
				(change) =>
					change.kind === 'view' && change.parent === tableId && app.ws.get(change.id) === undefined
			)
			.map((change) => ({ view: viewDef(ghostRec(change)), action }))
	);
}

/** A value held back with a proposed field: data entry built on it waits for the decision. */
export function ghostValue(rowId: string, fieldId: string): Value | undefined {
	for (const action of assistant.actions) {
		if (action.status !== 'pending' || action.tier !== 'apply') continue;
		const change = action.changes.find((candidate) => candidate.id === rowId);
		if (change !== undefined && fieldId in change.set) {
			return change.set[fieldId];
		}
	}
	return undefined;
}

export function isDoomed(id: string): boolean {
	return assistant.actions.some(
		(action) =>
			action.status === 'pending' &&
			action.tier === 'confirm' &&
			action.changes.some((change) => change.id === id && change.set[DELETED] === true)
	);
}
