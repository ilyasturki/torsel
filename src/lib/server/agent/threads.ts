import { randomUUID } from 'node:crypto';

import { and, desc, eq, inArray, isNull, lt, ne, sql } from 'drizzle-orm';

import type {
	ActionStatus,
	Attachment,
	EventContent,
	RowMeta,
	ThreadAction,
	ThreadRow,
	ThreadSummary
} from '../../core/thread.ts';
import { fitTitle, titleOf } from '../../core/thread.ts';
import type { Database } from '../db/client.ts';
import { WRITER } from '../db/client.ts';
import { threadActions, threadFiles, threadMessages, threads } from '../db/schema.ts';
import type { Executor } from '../db/seq.ts';

const LISTED = 100;

// An upload no message took within this long was abandoned.
const UNSENT_MS = 24 * 60 * 60 * 1000;

const SUMMARY = {
	id: threads.id,
	title: threads.title,
	source: threads.source,
	createdAt: threads.createdAt,
	updatedAt: threads.updatedAt
};

function summary(thread: {
	id: string;
	title: string;
	source: string | null;
	createdAt: Date;
	updatedAt: Date;
}): ThreadSummary {
	return {
		id: thread.id,
		title: thread.title,
		kind: thread.source === null ? 'assistant' : 'tool',
		createdAt: thread.createdAt.getTime(),
		updatedAt: thread.updatedAt.getTime()
	};
}

/** Titled by its first message until the generated title lands. */
export function createThread(db: Database, userId: string, prompt: string): ThreadSummary {
	const now = new Date();
	const thread = {
		id: randomUUID(),
		title: fitTitle(prompt),
		source: null,
		createdAt: now,
		updatedAt: now
	};
	db.insert(threads)
		.values({ ...thread, userId })
		.run();
	return summary(thread);
}

/** A generated title, unless the person named the thread meanwhile; whether it was taken. */
export function giveTitle(db: Database, threadId: string, title: string): boolean {
	return (
		db
			.update(threads)
			.set({ title })
			.where(and(eq(threads.id, threadId), eq(threads.named, false)))
			.run().changes > 0
	);
}

export function listThreads(db: Database, userId: string): ThreadSummary[] {
	return db
		.select(SUMMARY)
		.from(threads)
		.where(eq(threads.userId, userId))
		.orderBy(desc(threads.updatedAt))
		.limit(LISTED)
		.all()
		.map(summary);
}

export function findThread(db: Database, userId: string, id: string): ThreadSummary | undefined {
	const thread = db
		.select(SUMMARY)
		.from(threads)
		.where(and(eq(threads.id, id), eq(threads.userId, userId)))
		.get();
	return thread && summary(thread);
}

export function renameThread(db: Database, threadId: string, title: string): void {
	db.update(threads)
		.set({ title: titleOf(title), named: true })
		.where(eq(threads.id, threadId))
		.run();
}

export function deleteThread(db: Database, threadId: string): void {
	db.delete(threads).where(eq(threads.id, threadId)).run();
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

const ACTION_COLUMNS = {
	id: threadActions.id,
	turn: threadActions.turn,
	summary: threadActions.summary,
	changes: threadActions.changes,
	before: threadActions.before,
	status: threadActions.status
};

export function readActions(db: Database, threadId: string): ThreadAction[] {
	return db
		.select(ACTION_COLUMNS)
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

export function appendEvent(db: Database, threadId: string, event: EventContent): number {
	return db.transaction((tx) => append(tx, threadId, 'event', event, null), WRITER);
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
				// A durable queue says a decision twice, and the model must hear it once.
				.where(
					and(
						eq(threadActions.threadId, threadId),
						eq(threadActions.id, id),
						ne(threadActions.status, status)
					)
				)
				.run();
		}
	}, WRITER);
}

/** The message that told the model these left history, so the next one tells it again. */
export function unreportDecisions(db: Database, threadId: string, ids: string[]): void {
	db.transaction((tx) => {
		for (const id of ids) {
			tx.update(threadActions)
				.set({ reported: false })
				.where(and(eq(threadActions.threadId, threadId), eq(threadActions.id, id)))
				.run();
		}
	}, WRITER);
}

/** A replaced turn leaves the model's history: nothing it did is told as undone. */
export function silenceTurn(db: Database, threadId: string, turn: number): void {
	db.update(threadActions)
		.set({ reported: true })
		.where(and(eq(threadActions.threadId, threadId), eq(threadActions.turn, turn)))
		.run();
}

/** Decisions the model has not heard about yet. */
export function readUnreported(db: Database, threadId: string): ThreadAction[] {
	return db
		.select(ACTION_COLUMNS)
		.from(threadActions)
		.where(and(eq(threadActions.threadId, threadId), eq(threadActions.reported, false)))
		.orderBy(threadActions.seq)
		.all()
		.filter((action) => action.status === 'undone');
}

/** The person's message, which tells the model every decision still unreported, as one write. */
export function appendPrompt(
	db: Database,
	threadId: string,
	content: unknown,
	meta: RowMeta
): number {
	return db.transaction((tx) => {
		tx.update(threadActions)
			.set({ reported: true })
			.where(and(eq(threadActions.threadId, threadId), eq(threadActions.reported, false)))
			.run();
		return append(tx, threadId, 'user', content, meta);
	}, WRITER);
}

/** Starts an upload, or adds its next part: the bytes held so far, or null when the part doesn't fit. */
export function receivePart(
	db: Database,
	userId: string,
	file: Attachment,
	offset: number,
	part: Buffer
): number | null {
	return db.transaction((tx) => {
		if (offset === 0) {
			tx.delete(threadFiles)
				.where(
					and(
						isNull(threadFiles.threadId),
						lt(threadFiles.createdAt, new Date(Date.now() - UNSENT_MS))
					)
				)
				.run();
			tx.delete(threadFiles)
				.where(
					and(
						eq(threadFiles.id, file.id),
						eq(threadFiles.userId, userId),
						isNull(threadFiles.threadId)
					)
				)
				.run();
			tx.insert(threadFiles)
				.values({ ...file, userId, threadId: null, data: part, createdAt: new Date() })
				.run();
			return part.length;
		}
		const stored = tx
			.select({ data: threadFiles.data, size: threadFiles.size })
			.from(threadFiles)
			.where(
				and(
					eq(threadFiles.id, file.id),
					eq(threadFiles.userId, userId),
					isNull(threadFiles.threadId)
				)
			)
			.get();
		if (
			stored === undefined ||
			stored.data.length !== offset ||
			offset + part.length > stored.size
		) {
			return null;
		}
		const data = Buffer.concat([stored.data, part]);
		tx.update(threadFiles).set({ data }).where(eq(threadFiles.id, file.id)).run();
		return data.length;
	}, WRITER);
}

export type StoredFile = Attachment & { data: Buffer };

/** This person's complete uploads, taken by the thread their message goes to. */
export function claimFiles(
	db: Database,
	userId: string,
	threadId: string,
	ids: string[]
): Attachment[] {
	if (ids.length === 0) return [];
	return db.transaction((tx) => {
		const rows = tx
			.select({
				id: threadFiles.id,
				name: threadFiles.name,
				type: threadFiles.type,
				size: threadFiles.size,
				length: sql<number>`length(${threadFiles.data})`,
				threadId: threadFiles.threadId
			})
			.from(threadFiles)
			.where(and(eq(threadFiles.userId, userId), inArray(threadFiles.id, ids)))
			.all()
			.filter(
				(row) => row.length === row.size && (row.threadId === null || row.threadId === threadId)
			);
		if (rows.length > 0) {
			tx.update(threadFiles)
				.set({ threadId })
				.where(
					inArray(
						threadFiles.id,
						rows.map((row) => row.id)
					)
				)
				.run();
		}
		return ids.flatMap((id) => {
			const row = rows.find((candidate) => candidate.id === id);
			return row === undefined
				? []
				: [{ id: row.id, name: row.name, type: row.type, size: row.size }];
		});
	}, WRITER);
}

export function readFiles(db: Database, threadId: string): Map<string, StoredFile> {
	return new Map(
		db
			.select({
				id: threadFiles.id,
				name: threadFiles.name,
				type: threadFiles.type,
				size: threadFiles.size,
				data: threadFiles.data
			})
			.from(threadFiles)
			.where(eq(threadFiles.threadId, threadId))
			.all()
			.map((file) => [file.id, file])
	);
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
