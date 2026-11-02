import { error, json } from '@sveltejs/kit';

import type { ThreadRow } from '#lib/core/thread.ts';
import {
	activeTurn,
	deleteThread,
	findThread,
	readActions,
	readRows,
	renameThread
} from '#lib/server/agent/threads.ts';
import { getDatabase } from '#lib/server/db/client.ts';
import { readJsonBody, requiredString } from '#lib/server/http/body.ts';
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

function owned(locals: App.Locals, id: string) {
	const { user } = requireCredential(locals);
	const db = getDatabase();
	const thread = findThread(db, user.id, id);
	if (thread === undefined) {
		error(404, 'no such thread');
	}
	return { db, thread };
}

export const GET: RequestHandler = ({ locals, params }) => {
	const { db, thread } = owned(locals, params.id);
	return json({
		...thread,
		rows: readRows(db, thread.id).map(forClient),
		actions: readActions(db, thread.id)
	});
};

export const PATCH: RequestHandler = async ({ request, locals, params }) => {
	const { db, thread } = owned(locals, params.id);
	const title = requiredString(await readJsonBody(request), 'title').trim();
	if (title === '') {
		error(400, 'a title is needed');
	}
	renameThread(db, thread.id, title);
	return json(findThread(db, requireCredential(locals).user.id, thread.id));
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	const { db, thread } = owned(locals, params.id);
	const running = activeTurn(thread.id);
	if (running !== undefined) {
		running.abort.abort();
		await running.done;
	}
	deleteThread(db, thread.id);
	return new Response(null, { status: 204 });
};
