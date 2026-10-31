import { SvelteSet } from 'svelte/reactivity';

import { Hlc } from '../core/clock.ts';
import type { BaseDef, Change, FieldDef, Rec, TableDef, Value, ViewDef } from '../core/model.ts';
import { DELETED } from '../core/model.ts';
import type { SqlRow } from '../core/sql.ts';
import type {
	EventKind,
	ThreadAction,
	ThreadContext,
	ThreadRow,
	ThreadSummary,
	TurnEvent
} from '../core/thread.ts';
import { dependents, prerequisites } from '../core/thread.ts';
import { Workspace, tableDef } from '../core/workspace.ts';
import { ApiError, NO_SERVER, OFFLINE, apiBase, request, streamLines } from './api.ts';
import type { Group } from './app.svelte.ts';
import { app } from './app.svelte.ts';
import type { Decision } from './local.ts';
import { me } from './session.svelte.ts';
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
	busy: false,
	resumed: false
});

/** Rows the assistant just wrote, standing out in place for a moment. */
export const fresh = new SvelteSet<string>();

const FRESH_MS = 3000;

const THREAD_META = 'thread';

let controller: AbortController | null = null;

let flushing: Promise<void> = Promise.resolve();

async function deliver(thread: string, decisions: Decision[]): Promise<void> {
	try {
		await request(`/api/ai/threads/${thread}/decisions`, {
			method: 'POST',
			body: { decisions: decisions.map(({ id, status }) => ({ id, status })) }
		});
	} catch (error) {
		// A thread that's gone will never take them; anything else, the next flush tries again.
		if (!(error instanceof ApiError && error.status === 404)) {
			return;
		}
	}
	await app.delivered(decisions);
}

function flushDecisions(): Promise<void> {
	flushing = flushing
		.then(async () => {
			const held = await app.decisions();
			// Under another account a held thread answers 404, which would drop what its owner still owes.
			if (held.length === 0 || !me.account || (await app.meta<string>('owner')) !== me.account.id) {
				return;
			}
			for (const thread of new Set(held.map((decision) => decision.thread))) {
				await deliver(
					thread,
					held.filter((decision) => decision.thread === thread)
				);
			}
		})
		.catch(() => undefined);
	return flushing;
}

function decide(action: ThreadAction, status: ThreadAction['status']): void {
	action.status = status;
	app.decide({ thread: assistant.id as string, id: action.id, status });
	void flushDecisions();
}

/** The decision is already on its way to disk, in the transaction of the change it belongs to. */
function changed(action: ThreadAction | undefined, status: ThreadAction['status']): void {
	if (action !== undefined) {
		action.status = status;
	}
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

/** On another device a change's records can arrive ahead of its decision, and applying again would overwrite later edits. */
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
	const group = app.apply(changes, action.summary, 'ai', {
		thread: assistant.id as string,
		id: action.id
	});
	changed(action, 'applied');
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
	return action.status === 'applied' && app.history.some((item) => item.action === action.id);
}

export function undoAction(action: ThreadAction): void {
	const group = app.history.find((item) => item.action === action.id);
	if (group !== undefined) {
		app.undo(group.id);
		showToast(`Undid: ${action.summary}`);
	}
}

const openAction = (id: string | undefined): ThreadAction | undefined =>
	assistant.actions.find((candidate) => candidate.id === id);

function stepped(group: Group, status: ThreadAction['status']): void {
	if (group.action === undefined) return;
	const action = openAction(group.action);
	// A step saved before steps named their thread: only the open thread can say whose it is.
	if (action !== undefined && group.thread === undefined) {
		app.decide({ thread: assistant.id as string, id: action.id, status });
	}
	changed(action, status);
}

app.onUndo = (group) => stepped(group, 'undone');

app.onRedo = (group) => stepped(group, 'applied');

app.onSynced = () => void flushDecisions();

app.onDecided = (decisions) => {
	for (const { id, status } of decisions) {
		const action = openAction(id);
		if (action !== undefined) {
			action.status = status;
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
			{ body: { prompt, context, where }, signal },
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
	// Read ahead of the fetch: one delivered in between is then only said twice, never missed.
	const held = await app.decisions();
	const thread = await request<ThreadSummary & { rows: ThreadRow[]; actions: ThreadAction[] }>(
		`/api/ai/threads/${id}`
	);
	assistant.id = thread.id;
	assistant.title = thread.title;
	assistant.rows = thread.rows;
	assistant.actions = thread.actions.map((action) => ({
		...action,
		status: held.find((decision) => decision.id === action.id)?.status ?? action.status
	}));
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
	void flushDecisions();
	if (assistant.id === null) {
		const id = await app.meta<string | null>(THREAD_META);
		if (id) {
			await openThread(id).catch(() => app.setMeta(THREAD_META, null));
		}
	}
	assistant.resumed = true;
}

/** While a thread may still come back, a table not in the workspace may be one it proposes. */
export function mayResume(): boolean {
	return (
		assistant.available === null ||
		(assistant.available && (!me.asked || (Boolean(me.account) && !assistant.resumed)))
	);
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

export type GhostTable = {
	table: TableDef;
	action: ThreadAction;
	rows: number;
	base: BaseDef;
	baseProposed: boolean;
};

export type TablePreview = {
	fields: GhostField[];
	rows: Rec[];
	computed: Map<string, SqlRow>;
};

function waiting(): ThreadAction[] {
	return assistant.actions.filter(
		(action) => action.status === 'pending' && action.tier === 'propose'
	);
}

/** What undecided actions would add, held apart: the workspace is what syncs and reaches undo. */
function proposal(): Workspace {
	const held = new Workspace();
	const hlc = new Hlc('proposal');
	for (const action of assistant.actions) {
		if (action.status === 'pending' && action.tier !== 'confirm') {
			for (const change of action.changes) {
				if (app.ws.get(change.id) === undefined) {
					held.stamp(change, hlc.tick());
				}
			}
		}
	}
	return held;
}

function proposerOf(id: string): ThreadAction {
	return waiting().find((action) =>
		action.changes.some((change) => change.id === id)
	) as ThreadAction;
}

/** Proposed fields of a table, drawn in place: none of them is in the workspace yet. */
export function ghostFields(tableId: string): GhostField[] {
	return proposal()
		.fields(tableId)
		.map((field) => ({ field, action: proposerOf(field.id) }));
}

export function ghostViews(tableId: string): GhostView[] {
	return proposal()
		.views(tableId)
		.map((view) => ({ view, action: proposerOf(view.id) }));
}

/** Proposed tables whose base is there or proposed too: elsewhere they could not land. */
export function ghostTables(): GhostTable[] {
	const held = proposal();
	return waiting().flatMap((action) =>
		action.changes.flatMap((change) => {
			const rec = change.kind === 'table' ? held.get(change.id) : undefined;
			if (rec === undefined) return [];
			const table = tableDef(rec);
			const proposedBase = held.base(table.base);
			const base = proposedBase ?? app.ws.base(table.base);
			return base === undefined
				? []
				: [
						{
							table,
							action,
							rows: held.rows(table.id).length,
							base,
							baseProposed: proposedBase !== undefined
						}
					];
		})
	);
}

export function ghostTable(id: string): GhostTable | undefined {
	return ghostTables().find((ghost) => ghost.table.id === id);
}

export function previewTable(tableId: string): TablePreview {
	const held = proposal();
	return {
		fields: ghostFields(tableId),
		rows: held.rows(tableId),
		computed: app.computedIn(held, tableId)
	};
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
