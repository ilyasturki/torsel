import { SvelteSet } from 'svelte/reactivity';

import { goto } from '$app/navigation';

import type { Change } from '../core/model.ts';
import type {
	Attachment,
	Effect,
	EventKind,
	ThreadAction,
	ThreadContext,
	ThreadRow,
	ThreadSummary,
	TurnEvent
} from '../core/thread.ts';
import { MAX_FILE_BYTES, UPLOAD_PART, droppedSeqs } from '../core/thread.ts';
import { ApiError, NO_SERVER, OFFLINE, apiBase, deviceToken, request, streamLines } from './api.ts';
import type { Group } from './app.svelte.ts';
import { app } from './app.svelte.ts';
import { limitMessage, limitOf } from './limit.ts';
import type { Decision } from './local.ts';
import { HOME, SETTINGS, tableUrl } from './nav.ts';
import { me } from './session.svelte.ts';
import { downloadBackup } from './shell.svelte.ts';
import { syncNow } from './sync.svelte.ts';
import { showToast } from './toast.svelte.ts';

type LiveBlock = { type: string; text?: string; input?: unknown };

export type Upload = Attachment & { received: number; failed: boolean };

export const assistant = $state({
	available: null as boolean | null,
	id: null as string | null,
	title: '',
	rows: [] as ThreadRow[],
	actions: [] as ThreadAction[],
	threads: [] as ThreadSummary[],
	listing: false,
	busy: false,
	// Bumped each time the assistant shows the person another screen.
	moved: 0
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

/** Decisions held for threads under this account; another account's would be refused. */
async function owed(): Promise<Decision[]> {
	const held = await app.decisions();
	if (held.length === 0 || !me.account || (await app.meta<string>('owner')) !== me.account.id) {
		return [];
	}
	return held;
}

function flushDecisions(): Promise<void> {
	flushing = flushing
		.then(async () => {
			const held = await owed();
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

// IndexedDB can't clone a state proxy; the cast stops `snapshot` recursing through `Value`.
const plain = (changes: Change[]): Change[] => $state.snapshot(changes as unknown[]) as Change[];

function applyAction(action: ThreadAction): void {
	if (alreadyApplied(action)) {
		decide(action, 'applied');
		return;
	}
	app.apply(plain(action.changes), action.summary, 'ai', {
		thread: assistant.id as string,
		id: action.id
	});
	changed(action, 'applied');
	markFresh(action);
}

/** Applies what this device hasn't yet, in the order it came. */
function settle(): void {
	for (const action of assistant.actions) {
		if (action.status === 'pending') {
			applyAction(action);
		}
	}
}

/** Undoes one change: by its step while this device holds it, else by its stored before-values. */
function undoOne(action: ThreadAction): void {
	if (action.status !== 'applied') return;
	const group = app.history.find((item) => item.action === action.id);
	if (group !== undefined) {
		app.undo(group.id);
		return;
	}
	app.apply(plain(action.before), `Undo: ${action.summary}`);
	decide(action, 'undone');
}

function redoOne(action: ThreadAction): void {
	if (action.status !== 'undone') return;
	const group = app.undone.find((item) => item.action === action.id);
	if (group !== undefined) {
		app.redo(group.id);
		return;
	}
	app.apply(plain(action.changes), action.summary, 'ai', {
		thread: assistant.id as string,
		id: action.id
	});
	changed(action, 'applied');
	markFresh(action);
}

export function undoChange(action: ThreadAction): void {
	undoOne(action);
}

export function redoChange(action: ThreadAction): void {
	redoOne(action);
}

export function turnActions(turn: number): ThreadAction[] {
	return assistant.actions.filter((action) => action.turn === turn);
}

/** The last change first, so each one finds the records the next undo restores as it left them. */
export function undoTurn(turn: number): void {
	for (const action of turnActions(turn).toReversed()) {
		undoOne(action);
	}
}

export function redoTurn(turn: number): void {
	for (const action of turnActions(turn)) {
		redoOne(action);
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

function perform(effect: Effect): void {
	assistant.moved += 1;
	if (effect.kind === 'open') {
		void goto(tableUrl(effect.table, effect.view ?? undefined));
	} else if (effect.kind === 'home') {
		void goto(HOME);
	} else if (effect.kind === 'settings') {
		void goto(SETTINGS);
	} else {
		downloadBackup();
	}
}

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
		case 'turn': {
			const asked = rows.findLast((row) => row.role === 'user' && row.meta !== null);
			if (asked !== undefined && asked.seq === 0) asked.seq = event.seq;
			break;
		}
		case 'assistant':
			rows.push({ seq: 0, role: 'assistant', content: [], meta: null });
			break;
		case 'block':
			blocksOf(live)[event.index] =
				event.block.type === 'text'
					? { type: 'text', text: '' }
					: event.block.type === 'tool_use'
						? { ...event.block, input: {} }
						: event.block;
			break;
		case 'text':
			blocksOf(live)[event.index].text += event.text;
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
			if (event.effect !== null) {
				perform(event.effect);
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
		const limit = error.status === 429 ? limitOf(error.payload) : null;
		if (limit !== null) {
			return limitMessage(limit);
		}
		return error.status === OFFLINE || error.status === NO_SERVER
			? 'The assistant needs a connection to the server.'
			: error.message;
	}
	return 'Something went wrong. Try again.';
}

type Mode = 'send' | 'edit' | 'retry';

type Message = { prompt: string; context: ThreadContext; where: string; files: Attachment[] };

async function run(mode: Mode, message: Message | null): Promise<void> {
	assistant.busy = true;
	assistant.listing = false;
	controller = new AbortController();
	const { signal } = controller;
	let decisions: Decision[] = [];
	let answered = false;

	try {
		// Only edits not yet on the server need a sync first: the model reads the server's copy.
		await Promise.all([
			app.pending > 0 ? syncNow() : undefined,
			assistant.id === null && message !== null
				? request<ThreadSummary>('/api/ai/threads', {
						method: 'POST',
						body: { prompt: message.prompt }
					}).then((thread) => {
						assistant.id = thread.id;
						assistant.title = thread.title;
						void app.setMeta(THREAD_META, thread.id);
					})
				: undefined
		]);
		const thread = assistant.id as string;
		decisions = (await owed()).filter((decision) => decision.thread === thread);
		await streamLines<TurnEvent>(
			`/api/ai/threads/${thread}/messages`,
			{
				body: {
					mode,
					...(message === null
						? {}
						: {
								prompt: message.prompt,
								context: message.context,
								where: message.where,
								files: message.files.map((file) => file.id)
							}),
					decisions: decisions.map(({ id, status }) => ({ id, status }))
				},
				signal
			},
			onEvent
		);
		answered = true;
		void app.delivered(decisions);
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
	// The server's rows carry the seqs a later edit or retry names; a refused send left none there.
	if (assistant.id !== null && answered) {
		await refresh(assistant.id);
	}
}

export async function send(message: Message): Promise<void> {
	if (assistant.busy) return;
	assistant.rows.push({
		seq: 0,
		role: 'user',
		content: [],
		meta: {
			prompt: message.prompt,
			where: message.where,
			...(message.files.length > 0 ? { files: message.files } : {})
		}
	});
	await run('send', message);
}

/** The thread as the person reads it: what a retry or an edit took out is gone. */
function visible(rows: ThreadRow[]): ThreadRow[] {
	const dropped = droppedSeqs(rows);
	return rows.filter((row) => row.seq === 0 || !dropped(row.seq));
}

export function lastPrompt(): ThreadRow | undefined {
	return visible(assistant.rows).findLast((row) => row.role === 'user' && row.meta !== null);
}

/** Runs the last turn again from where it failed or stopped. */
export async function retry(): Promise<void> {
	if (assistant.busy || assistant.id === null) return;
	const rows = visible(assistant.rows);
	while (rows.at(-1)?.role === 'event') rows.pop();
	const last = rows.at(-1);
	if (last?.role === 'assistant') rows.pop();
	assistant.rows = rows;
	await run('retry', null);
}

/** Takes back the last message and what its turn changed, then sends its new words. */
export async function edit(message: Message): Promise<void> {
	const asked = lastPrompt();
	if (assistant.busy || assistant.id === null || asked === undefined || asked.seq === 0) return;
	undoTurn(asked.seq);
	const rows = visible(assistant.rows);
	const at = rows.indexOf(asked);
	assistant.rows = [
		...rows.slice(0, at),
		{
			seq: 0,
			role: 'user',
			content: [],
			meta: {
				prompt: message.prompt,
				where: message.where,
				...(message.files.length > 0 ? { files: message.files } : {})
			}
		}
	];
	await run('edit', message);
}

export function stop(): void {
	controller?.abort();
}

async function refresh(id: string): Promise<void> {
	const thread = await request<ThreadSummary & { rows: ThreadRow[]; actions: ThreadAction[] }>(
		`/api/ai/threads/${id}`
	).catch(() => null);
	if (thread === null || assistant.id !== id || assistant.busy) return;
	const held = await app.decisions();
	assistant.title = thread.title;
	assistant.rows = thread.rows;
	assistant.actions = thread.actions.map((action) => {
		const local = assistant.actions.find((candidate) => candidate.id === action.id);
		return {
			...action,
			status:
				held.find((decision) => decision.id === action.id)?.status ??
				(local !== undefined && local.status !== 'pending' ? local.status : action.status)
		};
	});
}

export async function openThread(id: string): Promise<void> {
	if (assistant.busy) stop();
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

export async function listThreads(): Promise<void> {
	assistant.threads = await request<ThreadSummary[]>('/api/ai/threads').catch(
		() => assistant.threads
	);
}

export async function showThreads(): Promise<void> {
	assistant.listing = !assistant.listing;
	if (assistant.listing) {
		await listThreads();
	}
}

export async function renameThread(id: string, title: string): Promise<void> {
	const renamed = await request<ThreadSummary>(`/api/ai/threads/${id}`, {
		method: 'PATCH',
		body: { title }
	});
	assistant.threads = assistant.threads.map((thread) => (thread.id === id ? renamed : thread));
	if (assistant.id === id) assistant.title = renamed.title;
}

// As long as the toast offering its undo stays up.
const DELETE_AFTER_MS = 6000;

const deleting = new Map<string, ReturnType<typeof setTimeout>>();

function sendDelete(id: string, keepalive = false): void {
	deleting.delete(id);
	const base = apiBase();
	const token = deviceToken();
	if (base === null) return;
	// Plain fetch: only it outlives the page, and a reload must not bring the thread back.
	void fetch(`${base}/api/ai/threads/${id}`, {
		method: 'DELETE',
		keepalive,
		headers: {
			'content-type': 'application/json',
			...(token === null ? {} : { authorization: `Bearer ${token}` })
		}
	}).catch(() => undefined);
}

if (typeof window !== 'undefined') {
	window.addEventListener('pagehide', () => {
		for (const [id, timer] of deleting) {
			clearTimeout(timer);
			sendDelete(id, true);
		}
	});
}

/** Leaves the list at once, and the server once the toast's undo has passed. */
export function deleteThread(id: string): void {
	const at = assistant.threads.findIndex((thread) => thread.id === id);
	const removed = assistant.threads[at];
	if (removed === undefined) return;
	const wasOpen = assistant.id === id;
	assistant.threads = assistant.threads.filter((thread) => thread.id !== id);
	if (wasOpen) {
		newThread();
		assistant.listing = true;
	}
	deleting.set(
		id,
		setTimeout(() => sendDelete(id), DELETE_AFTER_MS)
	);
	showToast('Thread deleted', () => {
		clearTimeout(deleting.get(id));
		deleting.delete(id);
		assistant.threads = [
			...assistant.threads.slice(0, at),
			removed,
			...assistant.threads.slice(at)
		];
		if (wasOpen) void openThread(id).then(() => (assistant.listing = true));
	});
}

/** The last thread comes back with the app. */
export async function resumeThread(): Promise<void> {
	void flushDecisions();
	if (assistant.id === null) {
		const id = await app.meta<string | null>(THREAD_META);
		if (id) {
			await openThread(id).catch(() => app.setMeta(THREAD_META, null));
		}
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

/** Sends a file in parts the server's body limit takes, `progress` told each step. */
export async function upload(
	file: File,
	progress: (received: number) => void
): Promise<Attachment> {
	if (file.size > MAX_FILE_BYTES) {
		throw new ApiError(413, 'Files go up to 10 MB.');
	}
	const attachment: Attachment = {
		id: crypto.randomUUID(),
		name: file.name,
		type: file.type,
		size: file.size
	};
	const query = new URLSearchParams({
		id: attachment.id,
		name: file.name,
		type: file.type,
		size: String(file.size)
	});
	for (let offset = 0; offset < file.size; offset += UPLOAD_PART) {
		const bytes = new Uint8Array(await file.slice(offset, offset + UPLOAD_PART).arrayBuffer());
		await request(`/api/ai/files?${query}&offset=${offset}`, { method: 'POST', bytes });
		progress(Math.min(file.size, offset + UPLOAD_PART));
	}
	return attachment;
}
