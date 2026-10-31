import { randomUUID } from 'node:crypto';

import { and, desc, eq, sql } from 'drizzle-orm';

import type {
	ActionStatus,
	EventContent,
	RowMeta,
	ThreadAction,
	ThreadRow,
	ThreadSummary
} from '../../core/thread.ts';
import type { Database } from '../db/client.ts';
import { WRITER } from '../db/client.ts';
import { threadActions, threadMessages, threads } from '../db/schema.ts';
import type { Executor } from '../db/seq.ts';

const TITLE_LENGTH = 60;

const LISTED = 100;

export function createThread(db: Database, userId: string, prompt: string): ThreadSummary {
	const line = prompt.trim().replace(/\s+/gu, ' ');
	const title = line.length > TITLE_LENGTH ? `${line.slice(0, TITLE_LENGTH).trimEnd()}…` : line;
	const now = new Date();
	const id = randomUUID();
	db.insert(threads).values({ id, userId, title, createdAt: now, updatedAt: now }).run();
	return { id, title, updatedAt: now.getTime() };
}

export function listThreads(db: Database, userId: string): ThreadSummary[] {
	return db
		.select({ id: threads.id, title: threads.title, updatedAt: threads.updatedAt })
		.from(threads)
		.where(eq(threads.userId, userId))
		.orderBy(desc(threads.updatedAt))
		.limit(LISTED)
		.all()
		.map((thread) => ({ ...thread, updatedAt: thread.updatedAt.getTime() }));
}

export function findThread(db: Database, userId: string, id: string): ThreadSummary | undefined {
	const thread = db
		.select({ id: threads.id, title: threads.title, updatedAt: threads.updatedAt })
		.from(threads)
		.where(and(eq(threads.id, id), eq(threads.userId, userId)))
		.get();
	return thread && { ...thread, updatedAt: thread.updatedAt.getTime() };
}

export function readRows(db: Database, threadId: string): ThreadRow[] {
	return db
		.select({
			seq: threadMessages.seq,
			role: threadMessages.role,
			content: threadMessages.content,
			meta: threadMessages.meta
		})
		.from(threadMessages)
		.where(eq(threadMessages.threadId, threadId))
		.orderBy(threadMessages.seq)
		.all();
}

export function readActions(db: Database, threadId: string): ThreadAction[] {
	return db
		.select({
			id: threadActions.id,
			tier: threadActions.tier,
			summary: threadActions.summary,
			detail: threadActions.detail,
			changes: threadActions.changes,
			after: threadActions.after,
			status: threadActions.status
		})
		.from(threadActions)
		.where(eq(threadActions.threadId, threadId))
		.orderBy(threadActions.seq)
		.all();
}

function nextSeq(tx: Executor, threadId: string): number {
	const row = tx
		.select({ last: sql<number | null>`max(${threadMessages.seq})` })
		.from(threadMessages)
		.where(eq(threadMessages.threadId, threadId))
		.get();
	return (row?.last ?? 0) + 1;
}

function append(
	tx: Executor,
	threadId: string,
	role: ThreadRow['role'],
	content: unknown,
	meta: RowMeta
): number {
	const seq = nextSeq(tx, threadId);
	const now = new Date();
	tx.insert(threadMessages).values({ threadId, seq, role, content, meta, createdAt: now }).run();
	tx.update(threads).set({ updatedAt: now }).where(eq(threads.id, threadId)).run();
	return seq;
}

export function appendMessages(
	db: Database,
	threadId: string,
	rows: { role: 'user' | 'assistant'; content: unknown; meta?: RowMeta }[]
): number[] {
	return db.transaction(
		(tx) => rows.map((row) => append(tx, threadId, row.role, row.content, row.meta ?? null)),
		WRITER
	);
}

export function appendEvent(db: Database, threadId: string, event: EventContent): void {
	db.transaction((tx) => append(tx, threadId, 'event', event, null), WRITER);
}

export function recordAction(db: Database, threadId: string, action: ThreadAction): void {
	db.transaction((tx) => {
		const seq = tx
			.select({ last: sql<number | null>`max(${threadActions.seq})` })
			.from(threadActions)
			.where(eq(threadActions.threadId, threadId))
			.get();
		tx.insert(threadActions)
			.values({ ...action, threadId, seq: (seq?.last ?? 0) + 1 })
			.run();
	}, WRITER);
}

export function recordDecisions(
	db: Database,
	threadId: string,
	decisions: { id: string; status: ActionStatus }[]
): void {
	db.transaction((tx) => {
		for (const { id, status } of decisions) {
			tx.update(threadActions)
				.set({ status, reported: false })
				.where(and(eq(threadActions.threadId, threadId), eq(threadActions.id, id)))
				.run();
		}
	}, WRITER);
}

/** Decisions the model has not heard about yet, marked as heard. */
export function takeUnreported(db: Database, threadId: string): ThreadAction[] {
	return db.transaction((tx) => {
		const unreported = eq(threadActions.reported, false);
		const scope = and(eq(threadActions.threadId, threadId), unreported);
		const out = tx
			.select({
				id: threadActions.id,
				tier: threadActions.tier,
				summary: threadActions.summary,
				detail: threadActions.detail,
				changes: threadActions.changes,
				after: threadActions.after,
				status: threadActions.status
			})
			.from(threadActions)
			.where(scope)
			.orderBy(threadActions.seq)
			.all()
			.filter((action) => action.status !== 'pending');
		for (const action of out) {
			tx.update(threadActions)
				.set({ reported: true })
				.where(and(eq(threadActions.threadId, threadId), eq(threadActions.id, action.id)))
				.run();
		}
		return out;
	}, WRITER);
}

type Running = { abort: AbortController; done: Promise<void> };

// One turn per thread: this process is the only server, and a second one would interleave its rows.
const running = new Map<string, Running>();

export function activeTurn(threadId: string): Running | undefined {
	return running.get(threadId);
}

export function trackTurn(threadId: string, abort: AbortController, done: Promise<void>): void {
	const entry = { abort, done };
	running.set(threadId, entry);
	void done.finally(() => {
		if (running.get(threadId) === entry) {
			running.delete(threadId);
		}
	});
}
