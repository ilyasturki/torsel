import type { Fetched } from '../net/guard.ts';
import { FetchRefused, guardedFetch } from '../net/guard.ts';
import type { Feed, Item } from './read.ts';
import { ReadFailed, readBody } from './read.ts';

export const AUTH_KINDS = ['none', 'header', 'query', 'bearer', 'basic'] as const;

export type AuthKind = (typeof AUTH_KINDS)[number];

/** How a source signs its requests; `name` is the header or query parameter that carries the key. */
export type Auth = { kind: AuthKind; name: string | null };

export type Problem =
	| 'scheme'
	| 'address'
	| 'timeout'
	| 'network'
	| 'size'
	| 'auth'
	| 'missing'
	| 'status'
	| 'limit'
	| 'redirects'
	| 'html'
	| 'format'
	| 'rows';

export class PullFailed extends Error {
	constructor(
		readonly problem: Problem,
		readonly retryAfterMs: number | null = null
	) {
		super(`pull failed: ${problem}`);
		this.name = 'PullFailed';
	}
}

export type Caps = { pages: number; rows: number; ms: number; pageBytes: number };

export const RUN_CAPS: Omit<Caps, 'rows'> = { pages: 50, ms: 60_000, pageBytes: 10 * 1024 * 1024 };

const REQUEST_MS = 30_000;
const MAX_HOPS = 3;
const ACCEPT =
	'application/json, text/csv, text/tab-separated-values, application/rss+xml, application/atom+xml, application/xml;q=0.9, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;q=0.9, */*;q=0.5';

type Get = typeof guardedFetch;

export type PullRequest = {
	url: string;
	auth: Auth;
	secret: string | null;
	rows: string | null;
};

export type Pulled = Omit<Feed, 'items' | 'next'> & {
	items: Item[];
	pages: number;
	// Every page read and every row kept: only then may rows missing at the source go.
	complete: boolean;
};

/** The URL as it may be stored or shown: a key carried in the query taken out. */
export function redact(url: string, auth: Auth): string {
	if (auth.kind !== 'query' || auth.name === null) return url;
	try {
		const parsed = new URL(url);
		parsed.searchParams.delete(auth.name);
		return parsed.href;
	} catch {
		return url;
	}
}

function signed(
	url: URL,
	origin: string,
	request: PullRequest
): { url: URL; headers: Record<string, string> } {
	const { auth, secret } = request;
	const headers: Record<string, string> = {};
	// The key goes only where the person pointed it.
	if (secret === null || secret === '' || url.origin !== origin) return { url, headers };
	if (auth.kind === 'bearer') {
		headers.authorization = `Bearer ${secret}`;
	} else if (auth.kind === 'basic') {
		headers.authorization = `Basic ${Buffer.from(secret).toString('base64')}`;
	} else if (auth.kind === 'header' && auth.name !== null) {
		headers[auth.name.toLowerCase()] = secret;
	} else if (auth.kind === 'query' && auth.name !== null) {
		const keyed = new URL(url);
		keyed.searchParams.set(auth.name, secret);
		return { url: keyed, headers };
	}
	return { url, headers };
}

/** The URL with the query key taken out, so only `signed` puts it back, and only for its origin. */
function unkeyed(url: URL, auth: Auth): URL {
	if (auth.kind !== 'query' || auth.name === null || !url.searchParams.has(auth.name)) return url;
	const bare = new URL(url);
	bare.searchParams.delete(auth.name);
	return bare;
}

function problemOf(error: unknown): PullFailed {
	if (error instanceof PullFailed) return error;
	if (error instanceof FetchRefused) return new PullFailed(error.reason);
	if (error instanceof ReadFailed) return new PullFailed(error.reason);
	return new PullFailed('network');
}

function retryAfter(answer: Fetched): number | null {
	const header = answer.headers['retry-after'];
	if (header === undefined) return null;
	const seconds = Number(header);
	if (Number.isFinite(seconds)) return Math.max(0, seconds) * 1000;
	const at = Date.parse(header);
	return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}

/** One page: redirects followed by hand, each hop through the guard, the key kept to its origin. */
async function page(
	get: Get,
	start: URL,
	origin: string,
	request: PullRequest,
	deadline: number,
	pageBytes: number
): Promise<Fetched> {
	let url = start;
	for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
		const left = deadline - Date.now();
		if (left <= 0) throw new PullFailed('timeout');
		const out = signed(url, origin, request);
		const answer = await get(out.url, {
			accept: ACCEPT,
			timeoutMs: Math.min(REQUEST_MS, left),
			maxBytes: pageBytes,
			maxRedirects: 0,
			headers: out.headers
		});
		const location = answer.headers.location;
		if (answer.status >= 300 && answer.status < 400 && location !== undefined) {
			url = unkeyed(new URL(location, url), request.auth);
			continue;
		}
		if (answer.status === 401 || answer.status === 403) throw new PullFailed('auth');
		if (answer.status === 404 || answer.status === 410) throw new PullFailed('missing');
		if (answer.status === 429) throw new PullFailed('limit', retryAfter(answer));
		if (answer.status < 200 || answer.status >= 300) throw new PullFailed('status');
		return answer;
	}
	throw new PullFailed('redirects');
}

/** The URL a `Link` header names as the next page. */
export function linkNext(header: string | undefined): string | null {
	if (header === undefined) return null;
	for (const part of header.split(/,(?=\s*<)/u)) {
		const match = /<([^>]*)>(.*)/u.exec(part.trim());
		const rel = match === null ? null : /;\s*rel\s*=\s*(?:"([^"]*)"|([^;\s]+))/iu.exec(match[2]);
		if (
			match !== null &&
			rel !== null &&
			(rel[1] ?? rel[2]).toLowerCase().split(/\s+/u).includes('next')
		) {
			return match[1];
		}
	}
	return null;
}

/** Reads every page of a source within the caps, stopping at the first failure. */
export async function pull(
	request: PullRequest,
	caps: Caps,
	get: Get = guardedFetch
): Promise<Pulled> {
	const deadline = Date.now() + caps.ms;
	let url: URL;
	try {
		url = unkeyed(new URL(request.url), request.auth);
	} catch {
		throw new PullFailed('scheme');
	}
	const origin = url.origin;
	const seen = new Set<string>();
	const paths = new Set<string>();
	const items: Item[] = [];
	let first: Feed | undefined;
	let pages = 0;
	let complete = true;

	try {
		for (;;) {
			seen.add(url.href);
			const answer = await page(get, url, origin, request, deadline, caps.pageBytes);
			const feed = readBody(answer.body, answer.headers['content-type'] ?? '', request.rows);
			first ??= feed;
			pages += 1;
			for (const path of feed.paths) paths.add(path);
			for (const item of feed.items) {
				if (items.length >= caps.rows) {
					complete = false;
					break;
				}
				items.push(item);
			}
			if (!complete) break;

			const next = linkNext(answer.headers.link) ?? feed.next;
			if (next === null) break;
			const following = unkeyed(new URL(next, answer.url), request.auth);
			if (seen.has(following.href)) break;
			if (pages >= caps.pages) {
				complete = false;
				break;
			}
			url = following;
		}
	} catch (error) {
		throw problemOf(error);
	}

	const feed = first as Feed;
	return {
		format: feed.format,
		paths: [...paths],
		items,
		rowPaths: feed.rowPaths,
		rows: feed.rows,
		pages,
		complete
	};
}
