import { error } from '@sveltejs/kit';

import type { ActionStatus } from '#lib/core/thread.ts';
import { findThread, recordDecisions } from '#lib/server/agent/threads.ts';
import { getDatabase } from '#lib/server/db/client.ts';
import { readJsonBody } from '#lib/server/http/body.ts';
import { requireCredential } from '#lib/server/http/guards.ts';

import type { RequestHandler } from './$types';

const DECIDED = new Set(['applied', 'rejected', 'undone']);

function isDecision(value: unknown): value is { id: string; status: ActionStatus } {
	if (typeof value !== 'object' || value === null) return false;
	const { id, status } = value as Record<string, unknown>;
	return typeof id === 'string' && typeof status === 'string' && DECIDED.has(status);
}

export const POST: RequestHandler = async ({ request, locals, params }) => {
	const { user } = requireCredential(locals);
	const db = getDatabase();
	const thread = findThread(db, user.id, params.id);
	if (thread === undefined) {
		error(404, 'no such thread');
	}
	const { decisions } = await readJsonBody(request);
	if (!Array.isArray(decisions) || !decisions.every(isDecision)) {
		error(400, 'expected { decisions: [{ id, status }] }');
	}
	recordDecisions(db, thread.id, decisions);
	return new Response(null, { status: 204 });
};
