import { error } from '@sveltejs/kit';

import type { ThreadContext, TurnEvent } from '#lib/core/thread.ts';
import { MAX_CONTEXT_ROWS, MAX_PROMPT } from '#lib/core/thread.ts';
import { runTurn } from '#lib/server/agent/assistant.ts';
import { refusedResponse, takePrompt } from '#lib/server/agent/quota.ts';
import { activeTurn, findThread, trackTurn } from '#lib/server/agent/threads.ts';
import { aiLimits, anthropicKey } from '#lib/server/config.ts';
import { getDatabase } from '#lib/server/db/client.ts';
import { readJsonBody, requiredString } from '#lib/server/http/body.ts';
import { requireCredential } from '#lib/server/http/guards.ts';

import type { RequestHandler } from './$types';

// Proxies drop a silent connection; a model can think for longer than their read timeout.
const PING_MS = 15_000;

function optional(value: unknown): string | null {
	return typeof value === 'string' && value !== '' ? value : null;
}

function contextOf(value: unknown): ThreadContext {
	const context =
		typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
	return {
		base: optional(context.base),
		table: optional(context.table),
		view: optional(context.view),
		rows: Array.isArray(context.rows)
			? context.rows
					.filter((row): row is string => typeof row === 'string')
					.slice(0, MAX_CONTEXT_ROWS)
			: []
	};
}

export const POST: RequestHandler = async ({ request, locals, params }) => {
	const { user } = requireCredential(locals);
	const db = getDatabase();
	const thread = findThread(db, user.id, params.id);
	if (thread === undefined) {
		error(404, 'no such thread');
	}

	const body = await readJsonBody(request);
	const prompt = requiredString(body, 'prompt');
	if (prompt.length > MAX_PROMPT) {
		error(400, 'prompt is too long');
	}
	if (anthropicKey() === undefined) {
		error(503, 'this server has no assistant configured');
	}

	const previous = activeTurn(thread.id);
	if (previous !== undefined) {
		if (!previous.abort.signal.aborted) {
			error(409, 'this thread is already answering');
		}
		await previous.done;
	}

	const refusal = takePrompt(db, user, aiLimits());
	if (refusal !== null) {
		return refusedResponse(refusal);
	}

	const abort = new AbortController();
	request.signal.addEventListener('abort', () => abort.abort(), { once: true });
	const encoder = new TextEncoder();

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const emit = (event: TurnEvent): void => {
				if (!abort.signal.aborted) {
					controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
				}
			};
			const ping = setInterval(() => emit({ type: 'ping' }), PING_MS);

			const done = runTurn({
				db,
				userId: user.id,
				threadId: thread.id,
				prompt,
				context: contextOf(body.context),
				where: typeof body.where === 'string' ? body.where.slice(0, 200) : '',
				signal: abort.signal,
				emit
			})
				.catch((thrown: unknown) => {
					console.error('assistant turn failed:', thrown);
					emit({
						type: 'event',
						event: { kind: 'error', message: 'Something went wrong on the server. Try again.' }
					});
				})
				.finally(() => {
					clearInterval(ping);
					emit({ type: 'done' });
					if (!abort.signal.aborted) {
						controller.close();
					}
				});

			trackTurn(thread.id, abort, done);
		},
		cancel() {
			abort.abort();
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'application/x-ndjson',
			'cache-control': 'no-cache',
			'x-accel-buffering': 'no'
		}
	});
};
