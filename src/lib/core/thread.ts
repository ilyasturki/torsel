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
	| { kind: 'event'; key: string; event: EventKind; message: string }
	| { kind: 'sources'; key: string; sources: Source[] };

/** A page the assistant read on the web, shown under the reply it served. */
export type Source = { url: string; title: string };

// Hosts the sources line shows; past them it is a list nobody reads.
export const MAX_SOURCES = 4;

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
	// What the turn's searches turned up, shown once its reply is in.
	let found: Source[] = [];

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
				found = [];
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
			// server ran itself (a search, a docs page), what follows in the same reply is the answer.
			const acting =
				content.some((block) => block?.type === 'tool_use') ||
				content.at(-1)?.type === 'server_tool_use';
			const read = content.findLastIndex(
				(block) => block?.type === 'server_tool_use' || (block?.type ?? '').endsWith('_tool_result')
			);
			const reply: string[] = [];
			let replyAt = -1;
			const cited: Source[] = [];
			content.forEach((block, index) => {
				if (block === undefined) return;
				if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
					found.push(...block.content.map(({ url, title }) => ({ url, title })));
				} else if (block.type === 'text' && !acting && index > read) {
					if (replyAt === -1) replyAt = index;
					reply.push(block.text);
					for (const citation of block.citations ?? []) {
						if (citation.type === 'web_search_result_location') {
							cited.push({ url: citation.url, title: citation.title ?? citation.url });
						}
					}
				} else if (block.type === 'tool_use') {
					const action = byId.get(block.id);
					if (action !== undefined) {
						items.push({ kind: 'change', key: block.id, action });
					}
				}
			});
			// A cited reply comes split around each citation, and reads as one.
			const text = reply.join('');
			if (text !== '') items.push({ kind: 'text', key: `${at}.${replyAt}`, text });
			if (!acting && content.length > 0) {
				const sources = shownSources(cited.length > 0 ? cited : found);
				if (sources.length > 0) items.push({ kind: 'sources', key: `${at}.sources`, sources });
				found = [];
			}
		}
	});

	return items;
}

/** One page per host, the first cited: the sources line names sites, not every page. */
export function shownSources(sources: Source[]): Source[] {
	const hosts = new Map<string, Source>();
	for (const source of sources) {
		let host: string;
		try {
			const url = new URL(source.url);
			if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
			host = url.hostname.replace(/^www\./u, '');
		} catch {
			continue;
		}
		if (!hosts.has(host)) hosts.set(host, { url: source.url, title: host });
		if (hosts.size === MAX_SOURCES) break;
	}
	return [...hosts.values()];
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

/** A request offered on an empty thread: a complete one sends as is, the rest wait in the box for the values. */
export type Suggestion = { text: string; complete: boolean };

export const MAX_SUGGESTIONS = 3;

// Past it a suggestion no longer fits its line in the panel.
export const MAX_SUGGESTION = 80;

/** The model's suggestions kept to what the panel shows: on one line, distinct, at most three. */
export function fitSuggestions(value: unknown): Suggestion[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	const out: Suggestion[] = [];
	for (const item of value) {
		if (typeof item !== 'object' || item === null) continue;
		const { text, complete } = item as Record<string, unknown>;
		if (typeof text !== 'string') continue;
		const line = text
			.replace(/\s+/gu, ' ')
			.trim()
			.replace(QUOTES, '')
			.trim()
			.replace(/[\s.,;:…\-–—]+$/u, '');
		if (line === '' || line.length > MAX_SUGGESTION || seen.has(line.toLowerCase())) continue;
		seen.add(line.toLowerCase());
		out.push({ text: line, complete: complete !== false });
		if (out.length === MAX_SUGGESTIONS) break;
	}
	return out;
}
