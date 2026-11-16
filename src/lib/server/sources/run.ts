import { createHash } from 'node:crypto';

import { PATH, SOURCE, hasPath } from '../../core/access.ts';
import type { Actor } from '../../core/access.ts';
import { updateRecord } from '../../core/actions.ts';
import { sameValue } from '../../core/entry.ts';
import type { Change, FieldDef, Value } from '../../core/model.ts';
import { CREATED, DELETED, hasChoices, isDeleted } from '../../core/model.ts';
import type { Every } from '../../core/source.ts';
import { markValue, sourceMark } from '../../core/source.ts';
import { coerce } from '../../core/values.ts';
import type { Workspace } from '../../core/workspace.ts';
import { sourceLimits } from '../config.ts';
import type { Database } from '../db/client.ts';
import { loadWorkspace, writeChanges } from '../db/records.ts';
import type { Source } from '../db/schema.ts';
import { serially } from '../db/serial.ts';
import type { Auth, Problem, Pulled } from './fetch.ts';
import { PullFailed, RUN_CAPS, pull } from './fetch.ts';
import type { Item } from './read.ts';
import { itemKey } from './read.ts';
import { open } from './secrets.ts';
import { readSource, tableLives, updateSource } from './store.ts';

/** What a run can leave a source with: a failed pull, or a run that read but couldn't take everything. */
export type SourceProblem = Problem | 'cap' | 'empty';

export type RunOutcome =
	| { ok: true; added: number; changed: number; removed: number; problem: SourceProblem | null }
	| { ok: false; problem: SourceProblem | 'gone' };

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const CHUNK = 500;
// Below this many failures in a row a passing outage stays quiet.
const QUIET_FAILURES = 3;
const TRANSIENT: ReadonlySet<SourceProblem> = new Set(['timeout', 'network', 'status', 'size']);

export const CONNECTOR = (user: string): Actor => ({ user, path: 'connector' });

export function bound(source: Pick<Source, 'userId' | 'tableId'>): string {
	return `${source.userId}:${source.tableId}`;
}

/** A row's id from its key: the same item lands on the same row each run. */
export function rowIdOf(tableId: string, key: string): string {
	const digest = createHash('sha256').update(`${tableId}:${key}`).digest();
	let id = 'r_';
	for (const byte of digest.subarray(0, 24))
		id += '0123456789abcdefghijklmnopqrstuvwxyz'[byte % 36];
	return id;
}

export function nextRun(every: Every, now: number): Date | null {
	if (every === 'manual') return null;
	return new Date(now + (every === 'hour' ? HOUR_MS : DAY_MS));
}

export function authOf(source: Source): Auth {
	return { kind: source.auth, name: source.authName };
}

/** Each source field by the path it reads. */
export function mappedFields(ws: Workspace, tableId: string): Map<string, FieldDef> {
	const mapped = new Map<string, FieldDef>();
	for (const field of ws.fields(tableId)) {
		const path = ws.get(field.id)?.data[PATH];
		if (hasPath(ws.get(field.id)) && typeof path === 'string' && !mapped.has(path)) {
			mapped.set(path, field);
		}
	}
	return mapped;
}

export type Planned = { changes: Change[]; added: number; changed: number; removed: number };

/** The changes that bring the table to what the source holds: only values that moved. */
export function plan(
	ws: Workspace,
	source: Pick<Source, 'tableId' | 'key' | 'filter' | 'missing'>,
	pulled: Pick<Pulled, 'items' | 'paths' | 'format' | 'complete'>,
	now: number
): Planned {
	const { tableId } = source;
	const table = ws.table(tableId);
	if (table === undefined) return { changes: [], added: 0, changed: 0, removed: 0 };
	const mapped = mappedFields(ws, tableId);
	const items = pulled.items.filter(
		(item) => source.filter === null || (item[source.filter] ?? '') !== ''
	);
	// A path no item holds says nothing about the values: keep them rather than empty them.
	const present = new Set(items.flatMap((item) => Object.keys(item)));
	// Feeds list the newest first; rows go in the order things happened.
	const ordered: Item[] =
		pulled.format === 'rss' || pulled.format === 'atom' ? items.toReversed() : items;

	const changes: Change[] = [];
	const seen = new Set<string>();
	let added = 0;
	let changed = 0;

	ordered.forEach((item, index) => {
		const key = itemKey(item, source.key, pulled.paths);
		if (key === '') return;
		const id = rowIdOf(tableId, key);
		if (seen.has(id)) return;
		seen.add(id);

		const values: Record<string, Value> = {};
		for (const [path, field] of mapped) {
			if (present.has(path)) values[field.id] = coerce(field, item[path] ?? null);
		}
		const rec = ws.get(id);
		const set: Record<string, Value> = {};
		if (rec === undefined) {
			set[CREATED] = now - ordered.length + index;
			Object.assign(set, values);
			added += 1;
		} else {
			if (isDeleted(rec)) {
				set[DELETED] = null;
				added += 1;
			}
			for (const [fieldId, value] of Object.entries(values)) {
				if (!sameValue(rec.data[fieldId], value)) set[fieldId] = value;
			}
			if (Object.keys(set).length === 0) return;
			if (!isDeleted(rec)) changed += 1;
		}
		changes.push({ id, kind: 'row', base: table.base, parent: tableId, set });
	});

	for (const field of mapped.values()) {
		if (!hasChoices(field.type)) continue;
		const known = new Set(field.choices.map((choice) => choice.name));
		const fresh = new Set<string>();
		for (const change of changes) {
			const value = change.set[field.id];
			for (const name of Array.isArray(value) ? value : [value]) {
				if (typeof name === 'string' && !known.has(name)) fresh.add(name);
			}
		}
		if (fresh.size > 0) {
			const choices = [
				...field.choices.map((choice) => ({ name: choice.name, color: choice.color })),
				...[...fresh].map((name) => ({ name, color: null }))
			];
			changes.unshift(...updateRecord(ws, field.id, { choices }));
		}
	}

	let removed = 0;
	if (source.missing === 'remove' && pulled.complete && seen.size > 0) {
		for (const row of ws.rows(tableId)) {
			if (!seen.has(row.id)) {
				changes.push({
					id: row.id,
					kind: 'row',
					base: table.base,
					parent: tableId,
					set: { [DELETED]: true }
				});
				removed += 1;
			}
		}
	}

	return { changes, added, changed, removed };
}

async function writeInChunks(
	db: Database,
	actor: Actor,
	ws: Workspace,
	changes: Change[]
): Promise<void> {
	for (let from = 0; from < changes.length; from += CHUNK) {
		writeChanges(db, actor, ws, changes.slice(from, from + CHUNK));
		// node:sqlite blocks the event loop: let requests through between chunks.
		await new Promise((resolve) => setImmediate(resolve));
	}
}

/** Writes the table's mark when it says something new. */
function markChanges(
	ws: Workspace,
	tableId: string,
	problem: string | null,
	at: number | null
): Change[] {
	const mark = sourceMark(ws.get(tableId));
	if (mark === null) return [];
	const next = { ...mark, problem, at: at ?? mark.at };
	if (next.problem === mark.problem && next.at === mark.at) return [];
	return updateRecord(ws, tableId, { [SOURCE]: markValue(next) });
}

function backoff(failures: number): number {
	return Math.min(DAY_MS, HOUR_MS * 2 ** Math.max(0, failures - 1));
}

function sameLink(current: Source | undefined, pulled: Source): current is Source {
	return current?.url === pulled.url && current.secret === pulled.secret;
}

async function failed(
	db: Database,
	source: Source,
	error: PullFailed,
	now: number
): Promise<RunOutcome | undefined> {
	const problem = error.problem;
	const limited = problem === 'limit';
	const failures = limited ? source.failures : source.failures + 1;
	const transient = TRANSIENT.has(problem) || problem === 'missing';
	let nextAt: Date | null;
	if (source.every === 'manual') {
		nextAt = null;
	} else if (limited) {
		nextAt = new Date(now + (error.retryAfterMs ?? HOUR_MS));
	} else if (transient && (problem !== 'missing' || failures < QUIET_FAILURES)) {
		nextAt = new Date(now + backoff(failures));
	} else {
		// Paused until the person changes the source or its key.
		nextAt = null;
	}
	const shown = limited || (transient && failures < QUIET_FAILURES) ? null : problem;

	const written = await serially(source.userId, async () => {
		if (!sameLink(readSource(db, source.userId, source.tableId), source)) return false;
		const ws = loadWorkspace(db, source.userId, source.baseId);
		const changes = markChanges(ws, source.tableId, shown, null);
		if (changes.length > 0) writeChanges(db, CONNECTOR(source.userId), ws, changes);
		updateSource(db, source.userId, source.tableId, {
			lastAt: new Date(now),
			failures,
			problem,
			nextAt
		});
		return true;
	});
	return written ? { ok: false, problem } : undefined;
}

type Get = Parameters<typeof pull>[2];

/** Reads the source and brings its table up to date; a failed run deletes nothing. */
export async function runSource(
	db: Database,
	userId: string,
	tableId: string,
	options: { get?: Get; now?: () => number } = {}
): Promise<RunOutcome> {
	const clock = options.now ?? Date.now;
	const source = readSource(db, userId, tableId);
	if (source === undefined) return { ok: false, problem: 'gone' };

	if (!tableLives(db, userId, tableId)) {
		// A deleted table pauses its source; an undo brings both back.
		updateSource(db, userId, tableId, { nextAt: nextRun(source.every, clock()) });
		return { ok: false, problem: 'gone' };
	}

	const again = () => runSource(db, userId, tableId, options);
	const secret = source.secret === null ? null : open(source.secret, bound(source));
	if (source.auth !== 'none' && secret === null) {
		return (await failed(db, source, new PullFailed('auth'), clock())) ?? again();
	}

	let pulled: Pulled;
	try {
		pulled = await pull(
			{ url: source.url, auth: authOf(source), secret, rows: source.rows },
			{ ...RUN_CAPS, rows: sourceLimits().rows },
			options.get
		);
	} catch (error) {
		const pullFailed = error instanceof PullFailed ? error : new PullFailed('network');
		return (await failed(db, source, pullFailed, clock())) ?? again();
	}

	const outcome = await serially(userId, async (): Promise<RunOutcome | undefined> => {
		const now = clock();
		const current = readSource(db, userId, tableId);
		const ws = loadWorkspace(db, userId, source.baseId);
		if (current === undefined || ws.table(tableId) === undefined) {
			return { ok: false, problem: 'gone' };
		}
		if (!sameLink(current, source)) return undefined;
		const planned = plan(ws, current, pulled, now);
		const kept = pulled.items.length > 0 || ws.rows(tableId).length === 0;
		const problem: SourceProblem | null = !kept ? 'empty' : pulled.complete ? null : 'cap';
		await writeInChunks(db, CONNECTOR(userId), ws, [
			...planned.changes,
			...markChanges(ws, tableId, problem, now)
		]);
		updateSource(db, userId, tableId, {
			lastAt: new Date(now),
			lastOkAt: new Date(now),
			failures: 0,
			problem,
			nextAt: nextRun(current.every, now)
		});
		return {
			ok: true,
			added: planned.added,
			changed: planned.changed,
			removed: planned.removed,
			problem
		};
	});
	return outcome ?? again();
}
