import type Anthropic from '@anthropic-ai/sdk';

import type { Change } from './model.ts';

export const MAX_PROMPT = 4000;

export const MAX_CONTEXT_ROWS = 200;

export const MAX_TITLE = 60;

// Whole in the desktop header; a phone's header and History row cut it past about 20.
export const MAX_GIVEN_TITLE = 32;

export const MAX_FILES = 5;

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

// adapter-node refuses a body over BODY_SIZE_LIMIT, 512K unless the server sets it.
export const UPLOAD_PART = 400_000;

export const ATTACHABLE =
	'.csv,.tsv,.txt,.md,.json,.xlsx,.pdf,image/png,image/jpeg,image/gif,image/webp,text/*';

export type ActionStatus = 'pending' | 'applied' | 'undone';

/** One write of the assistant: applied at once, undone by stamping `before`. */
export type ThreadAction = {
	id: string;
	// The seq of the person's message whose turn made it.
	turn: number;
	summary: string;
	changes: Change[];
	// What takes it back, in the order to stamp it; a deletion holds the whole record it removed.
	before: Change[];
	status: ActionStatus;
};

/** What the person sees, where the assistant can act from. */
export type Screen = 'home' | 'settings' | 'table';

export type ThreadContext = {
	screen: Screen;
	base: string | null;
	table: string | null;
	view: string | null;
	rows: string[];
	fields: string[];
	// The person's own date, which the server's time zone can't tell.
	today?: string;
	// How their screen writes a date and a number, for the reply to write them alike.
	shows?: Shows;
};

export type Shows = { locale: string; today: string; past: string; number: string };

export type Attachment = { id: string; name: string; type: string; size: number };

export type RowMeta = { prompt: string; where: string; files?: Attachment[] } | null;

export type EventKind = 'stopped' | 'declined' | 'error' | 'replaced';

// `excludes` leaves one row out of what the model is sent; `drops` leaves a range out of both the
// model's history and the thread the person reads.
export type EventContent = {
	kind: EventKind;
	message: string;
	excludes?: number;
	drops?: { from: number; to: number };
};

export type ThreadRow = {
	seq: number;
	role: 'user' | 'assistant' | 'event';
	content: unknown;
	meta: RowMeta;
};

/** `tool` holds what a connected tool (an MCP client) changed: it reads only, nothing is asked there. */
export type ThreadKind = 'assistant' | 'tool';

export type ThreadSummary = {
	id: string;
	title: string;
	kind: ThreadKind;
	createdAt: number;
	updatedAt: number;
};

/** What the app does on the screen for the assistant: no record changes. */
export type Effect =
	| { kind: 'open'; table: string; view: string | null }
	| { kind: 'home' }
	| { kind: 'settings' }
	| { kind: 'export' }
	| { kind: 'csv'; table: string; view: string | null };

export type TurnEvent =
	| { type: 'ping' }
	| { type: 'turn'; seq: number }
	| { type: 'assistant' }
	| { type: 'block'; index: number; block: { type: string; id?: string; name?: string } }
	| { type: 'text'; index: number; text: string }
	| { type: 'input'; index: number; input: unknown }
	| {
			type: 'result';
			id: string;
			isError: boolean;
			content: string;
			action: ThreadAction | null;
			effect: Effect | null;
	  }
	| { type: 'event'; event: EventContent }
	| { type: 'title'; title: string }
	| { type: 'done' };

export type Item =
	| { kind: 'user'; key: string; seq: number; text: string; where: string; files: Attachment[] }
	| { kind: 'text'; key: string; text: string }
	| { kind: 'change'; key: string; action: ThreadAction }
	| { kind: 'event'; key: string; event: EventKind; message: string };

type Block = Anthropic.Beta.BetaContentBlockParam;

function blocks(content: unknown): Block[] {
	return Array.isArray(content) ? (content as Block[]) : [];
}

/** Rows a later retry or edit took out of the thread. */
export function droppedSeqs(rows: ThreadRow[]): (seq: number) => boolean {
	const ranges = rows.flatMap((row) => {
		const drops = row.role === 'event' ? (row.content as EventContent).drops : undefined;
		return drops === undefined ? [] : [drops];
	});
	return (seq) => ranges.some(({ from, to }) => seq >= from && seq <= to);
}

/**
 * One rendering for a loaded thread and a streaming one: both are the same rows. Reads and failed
 * calls stay out of it; a write shows as its change.
 */
export function toItems(rows: ThreadRow[], actions: ThreadAction[]): Item[] {
	const items: Item[] = [];
	const dropped = droppedSeqs(rows);
	const byId = new Map(actions.map((action) => [action.id, action]));

	rows.forEach((row, at) => {
		// A row still streaming has seq 0, and nothing drops it.
		if (row.seq !== 0 && dropped(row.seq)) return;
		if (row.role === 'event') {
			const event = row.content as EventContent;
			if (event.kind !== 'replaced') {
				items.push({ kind: 'event', key: `${at}`, event: event.kind, message: event.message });
			}
		} else if (row.role === 'user') {
			if (row.meta !== null) {
				items.push({
					kind: 'user',
					key: `${at}`,
					seq: row.seq,
					text: row.meta.prompt,
					where: row.meta.where,
					files: row.meta.files ?? []
				});
			}
		} else {
			const content = blocks(row.content);
			// What a reply says on its way to a tool call is progress, not the answer; past a read the
			// server ran itself (a docs page), what follows in the same reply is the answer.
			const acting = content.some((block) => block?.type === 'tool_use');
			const read = content.findLastIndex(
				(block) => block?.type === 'server_tool_use' || (block?.type ?? '').endsWith('_tool_result')
			);
			content.forEach((block, index) => {
				if (block === undefined) return;
				if (block.type === 'text' && block.text !== '' && !acting && index > read) {
					items.push({ kind: 'text', key: `${at}.${index}`, text: block.text });
				} else if (block.type === 'tool_use') {
					const action = byId.get(block.id);
					if (action !== undefined) {
						items.push({ kind: 'change', key: block.id, action });
					}
				}
			});
		}
	});

	return items;
}

/** Past the last fallback block is what ran: what comes before it was declined with its model. */
export function afterFallback<T extends { type: string }>(content: T[]): T[] {
	const boundary = content.findLastIndex((block) => block.type === 'fallback');
	return boundary === -1 ? content : content.slice(boundary + 1);
}

/** The API's rule for sending back a turn that fell back mid-output. */
export function echoable<T extends { type: string }>(content: T[]): T[] {
	const boundary = content.findLastIndex((block) => block.type === 'fallback');
	return boundary === -1
		? content
		: content.filter(
				(block, index) =>
					index >= boundary || !['thinking', 'redacted_thinking', 'tool_use'].includes(block.type)
			);
}

/** A thread's title from its first message, on one line. */
export function titleOf(text: string): string {
	const line = text.trim().replace(/\s+/gu, ' ');
	return line.length > MAX_TITLE ? `${line.slice(0, MAX_TITLE).trimEnd()}…` : line;
}

const QUOTES = /^["'«»“”‘’`]+|["'«»“”‘’`]+$/gu;

const TRAILING = /[\s.,;:!?…\-–—]+$/u;

/** A generated title, or the first message standing in for it: on one line, cut whole words at the cap. */
export function fitTitle(text: string): string {
	const line = text.replace(/\s+/gu, ' ').trim().replace(QUOTES, '').trim().replace(TRAILING, '');
	if (line.length <= MAX_GIVEN_TITLE) return line;
	const cut = line.slice(0, MAX_GIVEN_TITLE + 1);
	const space = cut.lastIndexOf(' ');
	return (space > 0 ? cut.slice(0, space) : line.slice(0, MAX_GIVEN_TITLE)).replace(TRAILING, '');
}
