import { error, json } from '@sveltejs/kit';

import type { ThreadRow } from '#lib/core/thread.ts';
import { findThread, readActions, readRows } from '#lib/server/agent/threads.ts';
import { getDatabase } from '#lib/server/db/client.ts';
import { requireCredential } from '#lib/server/http/guards.ts';

import type { RequestHandler } from './$types';

/** A thinking block's signature is the model's, of no use to a client and sizeable. */
function forClient(row: ThreadRow): ThreadRow {
	if (row.role !== 'assistant' || !Array.isArray(row.content)) {
		return row;
	}
	return {
		...row,
		content: (row.content as Record<string, unknown>[]).map((block) => {
			if (block.type !== 'thinking') return block;
			const { signature: _, ...rest } = block;
			return rest;
		})
	};
}

export const GET: RequestHandler = ({ locals, params }) => {
	const { user } = requireCredential(locals);
	const db = getDatabase();
	const thread = findThread(db, user.id, params.id);
	if (thread === undefined) {
		error(404, 'no such thread');
	}
	return json({
		...thread,
		rows: readRows(db, thread.id).map(forClient),
		actions: readActions(db, thread.id)
	});
};
