import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import { Hlc } from '../../core/clock.ts';
import { latestClock } from '../../core/merge.ts';
import type { Change } from '../../core/model.ts';
import type {
	EventContent,
	ThreadAction,
	ThreadContext,
	ThreadRow,
	TurnEvent
} from '../../core/thread.ts';
import { afterFallback, echoable } from '../../core/thread.ts';
import { todayIso } from '../../core/values.ts';
import type { Workspace } from '../../core/workspace.ts';
import { anthropicKey } from '../config.ts';
import type { Database } from '../db/client.ts';
import { loadWorkspace } from '../db/records.ts';
import { envText } from '../env.ts';
import {
	appendEvent,
	appendMessages,
	appendPrompt,
	readActions,
	readRows,
	readUnreported,
	recordAction
} from './threads.ts';
import type { Action, ToolContext } from './toolkit.ts';
import { TOOLS, closeEngines, runTool, toolNamed } from './toolkit.ts';

const MAX_ROUNDS = 12;

// The system prompt and tool list are part of what a thinking block is bound to: keep them free of
// anything that varies per request. What varies goes in the user message, as contextNote does.
const SYSTEM = `You are the assistant inside Torsel, a data app: bases of typed tables (fields: text, number, date, choice, check, link, formula) shown through views (grid, entry, list, chart). The person talks to you in a thread beside their data, often on a phone and sometimes by dictation. Each of their messages starts with what they have open in the app and any decisions they made since your last reply.

Act with the tools rather than explaining how. Entering data (add_rows, update_rows) applies at once and the person can undo it. Creating or changing a base, table, field or view reaches them as a proposal they accept or reject, shown in place in their table. A deletion waits for their confirmation. So do not ask permission first: do what they ask and the app handles the rest. Ask a question only when you cannot tell what they mean or a wrong guess would be costly.

Each write's result has a status saying where it stands. You can build on a proposal in the same reply, such as add_rows on a table you just proposed: what you build on it follows their decision. Their decisions reach you in their next message. After a rejection the thing does not exist, so never use its id or speak as if it were there.

Read the schema before writing. Field names, existing choices and links come from there: reuse an existing choice rather than creating a near-duplicate ("bench press", not "Bench Press", if that is what the table holds). A value you were not given stays empty, never invented. Read data with query: read-only SQLite over views named like the tables and fields. The person keeps working while you talk, so read again rather than trusting an earlier result.

A request like "3x8 at 80 on bench" means three rows of 8 reps at 80 kg, on the existing exercise that matches, dated today. "Same as last time" is read from the history with query.

For a computed field, write an SQLite expression over the row's fields, names in double quotes, with a one-sentence description. For a view, pick the type that answers the request: chart for a progression, entry for fast input, list for browsing.

Reply in the person's language. Say what you did or proposed, then stop: the thread already shows each tool call with its result, so do not repeat them. Keep replies short. Bold, lists and small tables render; headings do not need to.`;

const TIER_NOTE = {
	read: '',
	apply: ' Applies at once; the person can undo it.',
	propose: ' Reaches the person as a proposal they accept or reject.',
	confirm: ' Waits for the person to confirm.'
};

function inputSchema(schema: z.ZodObject): Anthropic.Beta.BetaTool.InputSchema {
	const { $schema: _, ...json } = z.toJSONSchema(schema) as Record<string, unknown>;
	return json as Anthropic.Beta.BetaTool.InputSchema;
}

const TOOL_DEFS: Anthropic.Beta.BetaTool[] = TOOLS.map((tool) => ({
	name: tool.name,
	description: `${tool.description}${TIER_NOTE[tool.tier]}`,
	input_schema: inputSchema(tool.input)
}));

function statusOf(action: ThreadAction): string {
	if (action.tier === 'propose') return 'proposed: waiting for the person to accept or reject it';
	if (action.tier === 'confirm') return 'waiting for the person to confirm';
	return action.after.length > 0
		? 'held until the person decides on what it builds on'
		: 'applied';
}

export class AssistantUnavailable extends Error {}

function decisionLine({ tier, status, summary }: ThreadAction): string {
	if (tier === 'confirm') {
		return status === 'applied'
			? `- Deleted: ${summary}.`
			: status === 'rejected'
				? `- Kept, nothing was deleted: ${summary}.`
				: `- Deleted, then undone, so it is back: ${summary}.`;
	}
	return status === 'applied'
		? `- Accepted: ${summary}.`
		: status === 'rejected'
			? `- Rejected: ${summary}. It did not happen and nothing it made exists; do not use its ids.`
			: `- Undone: ${summary}. It no longer applies and nothing it made exists; do not use its ids.`;
}

function contextNote(
	ws: Workspace,
	context: ThreadContext,
	decided: ThreadAction[],
	pending: ThreadAction[],
	stopped: boolean
): string {
	const lines = [`Today: ${todayIso()}.`];

	const base = context.base === null ? undefined : ws.base(context.base);
	const table = context.table === null ? undefined : ws.table(context.table);
	if (base !== undefined && table !== undefined) {
		lines.push(`Open: base "${base.name}" (${base.id}), table "${table.name}" (${table.id}).`);
		const view = context.view === null ? undefined : ws.view(context.view);
		if (view !== undefined) {
			lines.push(`View: "${view.name}" (${view.type}).`);
		}
		const rows = context.rows.filter((id) => ws.live(id)?.parent === table.id);
		if (rows.length > 0) {
			lines.push(`Selected rows: ${rows.join(', ')}.`);
		}
	} else {
		const names = ws.bases().map((candidate) => `"${candidate.name}" (${candidate.id})`);
		lines.push(`No table open. Bases: ${names.join(', ') || 'none'}.`);
	}

	if (stopped) {
		lines.push('The person stopped your previous reply before it finished.');
	}

	const reported = decided.filter(
		(action) => action.tier !== 'apply' || action.status !== 'applied'
	);
	if (reported.length > 0) {
		lines.push('Decisions since your last reply:');
		lines.push(...reported.map(decisionLine));
	}

	const waiting = pending.filter((action) => action.tier !== 'apply');
	if (waiting.length > 0) {
		lines.push('Still waiting for the person:');
		for (const action of waiting) {
			lines.push(`- ${action.summary}.`);
		}
	}

	return lines.join('\n');
}

function replay(rows: ThreadRow[]): Anthropic.Beta.BetaMessageParam[] {
	const excluded = new Set(
		rows.flatMap((row) =>
			row.role === 'event' && (row.content as EventContent).excludes !== undefined
				? [(row.content as EventContent).excludes]
				: []
		)
	);
	const out: Anthropic.Beta.BetaMessageParam[] = [];
	for (const row of rows) {
		if (row.role !== 'event' && !excluded.has(row.seq)) {
			out.push({
				role: row.role,
				content: echoable(row.content as Anthropic.Beta.BetaContentBlockParam[])
			});
		}
	}
	return out;
}

function errorText(thrown: unknown): string {
	if (thrown instanceof Anthropic.RateLimitError) {
		return 'The assistant is busy. Try again in a moment.';
	}
	if (thrown instanceof Anthropic.AuthenticationError) {
		return 'This server’s API key was refused.';
	}
	if (thrown instanceof Anthropic.APIConnectionError) {
		return 'This server can’t reach the assistant.';
	}
	return 'The assistant stopped responding. Try again.';
}

export type Turn = {
	db: Database;
	userId: string;
	threadId: string;
	prompt: string;
	context: ThreadContext;
	where: string;
	signal: AbortSignal;
	emit(event: TurnEvent): void;
};

export async function runTurn(turn: Turn): Promise<void> {
	const { db, userId, threadId, prompt, context, where, signal, emit } = turn;

	const apiKey = anthropicKey();
	if (apiKey === undefined) {
		throw new AssistantUnavailable('this server has no ANTHROPIC_API_KEY');
	}
	const client = new Anthropic({ apiKey });
	const model = envText('TORSEL_AI_MODEL', 'claude-opus-5-5');

	const ws = loadWorkspace(db, userId);
	const hlc = new Hlc('ai');

	const stamp = (changes: Change[]): void => {
		for (const change of changes) {
			const existing = ws.get(change.id);
			if (existing !== undefined) {
				hlc.observe(latestClock(existing));
			}
			ws.stamp(change, hlc.tick());
		}
	};

	// Records that exist only because an undecided action made them, and which action that was.
	const heldBy = new Map<string, string>();
	const hold = (id: string, changes: Change[]): void => {
		for (const change of changes) {
			if (ws.get(change.id) === undefined) {
				heldBy.set(change.id, id);
			}
		}
	};
	const pending = readActions(db, threadId).filter((action) => action.status === 'pending');
	for (const action of pending) {
		if (action.tier !== 'apply' || action.after.length > 0) {
			hold(action.id, action.changes);
		}
		stamp(action.changes);
	}

	let current = '';
	let committed: ThreadAction | null = null;
	const ctx: ToolContext = {
		ws,
		commit(action: Action) {
			const text = JSON.stringify(action.changes);
			const after = [...new Set(heldBy)]
				.filter(([record]) => text.includes(record))
				.map(([, id]) => id);
			committed = {
				id: current,
				tier: action.tier,
				summary: action.summary,
				detail: action.detail ?? [],
				changes: action.changes,
				after: [...new Set(after)],
				status: 'pending'
			};
			if (action.tier !== 'apply' || after.length > 0) {
				hold(current, action.changes);
			}
			stamp(action.changes);
		}
	};

	const last = readRows(db, threadId).at(-1);
	const stopped = last?.role === 'event' && (last.content as EventContent).kind === 'stopped';
	const decided = readUnreported(db, threadId);
	const note = contextNote(ws, context, decided, pending, stopped);
	const userSeq = appendPrompt(
		db,
		threadId,
		[
			{ type: 'text', text: note },
			{ type: 'text', text: prompt }
		],
		{ prompt, where },
		decided
	);
	const messages = replay(readRows(db, threadId));

	const finish = (event: EventContent): void => {
		appendEvent(db, threadId, event);
		emit({ type: 'event', event });
	};

	let partial = '';

	try {
		for (let round = 0; round < MAX_ROUNDS; round += 1) {
			partial = '';

			const stream = client.beta.messages.stream(
				{
					model,
					max_tokens: 64000,
					betas: [
						'server-side-fallback-2026-07-01',
						'thinking-display-updates-2026-08-18',
						'thinking-binding-controls-2026-08-01'
					],
					fallbacks: 'default',
					// A deploy that edits the prompt or a tool must not turn every old thread into a 400.
					thinking: {
						type: 'adaptive',
						display: 'updates',
						block_binding: { prefix_mismatch_behavior: 'drop_block' }
					},
					output_config: { effort: 'medium' },
					cache_control: { type: 'ephemeral' },
					system: SYSTEM,
					tools: TOOL_DEFS,
					messages
				},
				{ signal }
			);

			for await (const event of stream) {
				if (event.type === 'message_start') {
					emit({ type: 'assistant' });
				} else if (event.type === 'content_block_start') {
					const block = event.content_block;
					emit({
						type: 'block',
						index: event.index,
						block:
							block.type === 'tool_use'
								? { type: block.type, id: block.id, name: block.name }
								: { type: block.type }
					});
				} else if (event.type === 'content_block_delta') {
					if (event.delta.type === 'text_delta') {
						partial += event.delta.text;
						emit({ type: 'text', index: event.index, text: event.delta.text });
					} else if (event.delta.type === 'thinking_delta') {
						emit({ type: 'note', index: event.index, text: event.delta.thinking });
					}
				} else if (event.type === 'content_block_stop') {
					const block = stream.currentMessage?.content[event.index];
					if (block?.type === 'tool_use') {
						emit({ type: 'input', index: event.index, input: block.input });
					}
				}
			}

			const message = await stream.finalMessage();

			// Partial output of a declined reply is discarded; what earlier rounds did stands.
			if (message.stop_reason === 'refusal') {
				finish({
					kind: 'declined',
					message: 'The assistant declined this request.',
					...(round === 0 ? { excludes: userSeq } : {})
				});
				return;
			}

			const uses = afterFallback(message.content).filter(
				(block): block is Anthropic.Beta.BetaToolUseBlock => block.type === 'tool_use'
			);
			const content = echoable(message.content);

			if (uses.length === 0) {
				appendMessages(db, threadId, [{ role: 'assistant', content }]);
				return;
			}

			// A tool input cut off at max_tokens can still parse, so none of it runs.
			if (message.stop_reason === 'max_tokens') {
				appendMessages(db, threadId, [
					{ role: 'assistant', content },
					{
						role: 'user',
						content: uses.map((use) => ({
							type: 'tool_result',
							tool_use_id: use.id,
							is_error: true,
							content: JSON.stringify({ error: 'the reply ran out of room before this call' })
						}))
					}
				]);
				for (const use of uses) {
					emit({
						type: 'result',
						id: use.id,
						isError: true,
						content: JSON.stringify({ error: 'the reply ran out of room before this call' }),
						action: null
					});
				}
				finish({
					kind: 'error',
					message: 'The reply ran out of room. Ask again in smaller steps.'
				});
				return;
			}

			const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
			for (const use of uses) {
				current = use.id;
				committed = null;
				const tool = toolNamed(use.name);
				let outcome: Awaited<ReturnType<typeof runTool>>;
				try {
					outcome =
						tool === undefined
							? { ok: false, error: `unknown tool: ${use.name}` }
							: await runTool(ctx, tool, use.input);
				} catch (thrown) {
					console.error('assistant tool failed:', thrown);
					outcome = { ok: false, error: 'this call failed on the server' };
				}

				const action = committed as ThreadAction | null;
				const body = JSON.stringify(
					!outcome.ok
						? { error: outcome.error }
						: action === null
							? outcome.result
							: { ...(outcome.result as object), status: statusOf(action) }
				);
				if (action !== null) {
					recordAction(db, threadId, action);
				}
				results.push({
					type: 'tool_result',
					tool_use_id: use.id,
					is_error: !outcome.ok,
					content: body
				});
				emit({ type: 'result', id: use.id, isError: !outcome.ok, content: body, action });
			}

			appendMessages(db, threadId, [
				{ role: 'assistant', content },
				{ role: 'user', content: results }
			]);
			messages.push({ role: 'assistant', content }, { role: 'user', content: results });
			partial = '';

			if (signal.aborted) {
				finish({ kind: 'stopped', message: 'Stopped.' });
				return;
			}
		}

		finish({
			kind: 'error',
			message: `Stopped after ${MAX_ROUNDS} steps. Ask again to carry on.`
		});
	} catch (thrown) {
		// What the person already read stays, as plain text: no half thinking or tool block can replay.
		const kept = partial.trim();
		if (kept !== '') {
			appendMessages(db, threadId, [
				{ role: 'assistant', content: [{ type: 'text', text: kept }] }
			]);
		}
		if (signal.aborted || thrown instanceof Anthropic.APIUserAbortError) {
			finish({ kind: 'stopped', message: 'Stopped.' });
		} else {
			console.error('assistant:', thrown);
			finish({ kind: 'error', message: errorText(thrown) });
		}
	} finally {
		closeEngines(ws);
	}
}
