import { DELETED } from '../../core/model.ts';
import type { RunResult, SourceHost } from '../agent/source-tools.ts';
import { SourceFailure } from '../agent/source-tools.ts';
import type { Database } from '../db/client.ts';
import { SourceRefused, createSource, patchSource, previewSource, stopSource } from './connect.ts';
import { PullFailed } from './fetch.ts';
import { runSource } from './run.ts';
import type { Limited } from './limits.ts';
import { overLimit } from './limits.ts';
import { readSource } from './store.ts';

async function coded<T>(work: () => Promise<T>): Promise<T> {
	try {
		return await work();
	} catch (error) {
		if (error instanceof PullFailed) throw new SourceFailure(error.problem);
		if (error instanceof SourceRefused) throw new SourceFailure(error.reason);
		throw error;
	}
}

function within(kind: Limited, userId: string): void {
	if (overLimit(kind, userId)) throw new SourceFailure('busy');
}

/** The assistant's and MCP's way to link tables, as the account. */
export function sourceHost(db: Database, userId: string): SourceHost {
	return {
		preview: (input) =>
			coded(() => {
				within('preview', userId);
				return previewSource({ ...input, secret: null });
			}),
		connect: (request) =>
			coded(async () => {
				within('create', userId);
				const made = await createSource(db, userId, { ...request, secret: null });
				const run: RunResult = await runSource(db, userId, made.table);
				// Undone, the table is deleted; redone, these bring it back.
				const changes = made.changes
					.filter((change) => change.kind !== 'base')
					.map((change) => ({ ...change, set: { ...change.set, [DELETED]: null } }));
				return { table: made.table, base: made.base, changes, run };
			}),
		refresh: (table) =>
			coded(async () => {
				if (readSource(db, userId, table) === undefined) throw new SourceRefused('gone');
				within('refresh', userId);
				return runSource(db, userId, table);
			}),
		update(table, patch) {
			if (readSource(db, userId, table) === undefined) throw new SourceFailure('gone');
			patchSource(db, userId, table, patch);
		},
		stop: (table) =>
			coded(async () => {
				if (readSource(db, userId, table) === undefined) throw new SourceRefused('gone');
				await stopSource(db, userId, table);
			})
	};
}
