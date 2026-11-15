import { error } from '@sveltejs/kit';

import { assistant as words } from '#lib/i18n/assistant.ts';
import { locale } from '#lib/i18n/runtime.ts';
import type { Screen, ThreadContext, TurnEvent } from '#lib/core/thread.ts';
import { MAX_CONTEXT_ROWS, MAX_FILES, MAX_PROMPT } from '#lib/core/thread.ts';
import type { Ask } from '#lib/server/agent/assistant.ts';
import { runTurn } from '#lib/server/agent/assistant.ts';
import { refusedResponse, takePrompt } from '#lib/server/agent/quota.ts';
import {
	activeTurn,
	claimFiles,
	findThread,
	recordDecisions,
	trackTurn
} from '#lib/server/agent/threads.ts';
import { aiLimits, anthropicKey } from '#lib/server/config.ts';
import { getDatabase } from '#lib/server/db/client.ts';
import { readJsonBody, requiredString } from '#lib/server/http/body.ts';
import { requireCredential } from '#lib/server/http/guards.ts';
import { inLocale } from '#lib/server/http/locale.ts';

import type { RequestHandler } from './$types';

// Proxies drop a silent connection; a model can think for longer than their read timeout.
const PING_MS = 15_000;

const SCREENS = new Set<Screen>(['home', 'settings', 'table']);

function optional(value: unknown): string | null {
	return typeof value === 'string' && value !== '' ? value : null;
}

function strings(value: unknown, limit: number): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === 'string').slice(0, limit)
		: [];
}

function contextOf(value: unknown): ThreadContext {
	const context =
		typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
	const today = optional(context.today);
	return {
		screen: SCREENS.has(context.screen as Screen) ? (context.screen as Screen) : 'home',
		base: optional(context.base),
		table: optional(context.table),
		view: optional(context.view),
		rows: strings(context.rows, MAX_CONTEXT_ROWS),
		fields: strings(context.fields, MAX_CONTEXT_ROWS),
		...(today !== null && /^\d{4}-\d{2}-\d{2}$/u.test(today) ? { today } : {})
	};
}

function decisionsOf(value: unknown): { id: string; status: 'applied' | 'undone' }[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => {
		const { id, status } = (typeof item === 'object' && item !== null ? item : {}) as Record<
			string,
			unknown
		>;
		return typeof id === 'string' && (status === 'applied' || status === 'undone')
			? [{ id, status }]
			: [];
	});
}

export const POST: RequestHandler = async ({ request, locals, params }) => {
	const { user } = requireCredential(locals);
	const db = getDatabase();
	const thread = findThread(db, user.id, params.id);
	if (thread === undefined) {
		error(404, words.noThread);
	}

	const body = await readJsonBody(request);
	const mode = body.mode === 'retry' || body.mode === 'edit' ? body.mode : 'send';
	const prompt = mode === 'retry' ? '' : requiredString(body, 'prompt');
	if (prompt.length > MAX_PROMPT) {
		error(400, words.promptTooLong);
	}
	if (anthropicKey() === undefined) {
		error(503, words.noAssistant);
	}

	const previous = activeTurn(thread.id);
	if (previous !== undefined) {
		if (!previous.abort.signal.aborted) {
			error(409, words.alreadyAnswering);
		}
		await previous.done;
	}

	// Carried here rather than flushed ahead, so the send doesn't wait on a round trip.
	recordDecisions(db, thread.id, decisionsOf(body.decisions));

	const refusal = takePrompt(db, user, aiLimits());
	if (refusal !== null) {
		return refusedResponse(refusal);
	}

	const where = typeof body.where === 'string' ? body.where.slice(0, 200) : '';
	const files = claimFiles(db, user.id, thread.id, strings(body.files, MAX_FILES));
	const ask: Ask =
		mode === 'retry'
			? { kind: 'retry' }
			: {
					kind: mode,
					prompt,
					context: contextOf(body.context),
					meta: { prompt, where, ...(files.length > 0 ? { files } : {}) }
				};

	const language = locale();
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

			// The turn outlives the request's own context: its words stay in the request's language.
			const done = inLocale(language, () =>
				runTurn({
					db,
					userId: user.id,
					threadId: thread.id,
					ask,
					signal: abort.signal,
					emit
				})
			)
				.catch((thrown: unknown) => {
					console.error('assistant turn failed:', thrown);
					emit({
						type: 'event',
						event: { kind: 'error', message: words.serverWrong }
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
