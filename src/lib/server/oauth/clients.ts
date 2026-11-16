import { randomBytes } from 'node:crypto';

import { and, eq, lt, notExists } from 'drizzle-orm';

import { fetchesPrivate } from '../config.ts';
import type { Database } from '../db/client.ts';
import { oauthClients, oauthGrants } from '../db/schema.ts';
import { isRecord } from '../json.ts';
import { FetchRefused, guardedFetch } from '../net/guard.ts';
import { isLoopback, validRedirect } from './redirects.ts';

export type Client = {
	id: string;
	name: string;
	/** The host of a metadata URL client id: who vouches for the name. Null for a self-registered client. */
	host: string | null;
	redirectUris: string[];
};

export type ClientLookup = { ok: true; client: Client } | { ok: false; unreachable: boolean };

const MAX_NAME = 80;
const MAX_REDIRECTS = 10;
const MAX_CLIENT_ID = 2000;

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_FRESH_S = 300;
const MAX_FRESH_S = 86_400;
const MAX_CACHED = 500;

// draft-ietf-oauth-client-id-metadata-document-03 §6: a small document, no redirects, quickly.
const DOCUMENT_BUDGET = {
	accept: 'application/json',
	timeoutMs: 5000,
	maxBytes: 5 * 1024,
	maxRedirects: 0
};

// oxlint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/gu;

function displayName(value: unknown): string | null {
	if (typeof value !== 'string') {
		return null;
	}
	const collapsed = value.replace(CONTROL, '').replace(/\s+/gu, ' ').trim();
	const name = [...collapsed].slice(0, MAX_NAME).join('').trim();
	return name === '' ? null : name;
}

function redirectList(value: unknown): string[] | null {
	if (!Array.isArray(value) || value.length === 0 || value.length > MAX_REDIRECTS) {
		return null;
	}
	return value.every((uri) => typeof uri === 'string' && validRedirect(uri))
		? (value as string[])
		: null;
}

function offers(value: unknown, needed: string): boolean {
	return value === undefined || (Array.isArray(value) && value.includes(needed));
}

/** A client id that names its own metadata document, or null when it can't be one. */
export function metadataUrl(clientId: string, origin: string): URL | null {
	if (clientId.length > MAX_CLIENT_ID || clientId.includes('#')) {
		return null;
	}
	let url: URL;
	try {
		url = new URL(clientId);
	} catch {
		return null;
	}
	// The parsed form must be the id itself: no dot segments, case or default port to normalise away.
	if (url.href !== clientId || url.username !== '' || url.password !== '') {
		return null;
	}
	const fixture = isLoopback(clientId) && fetchesPrivate();
	if (url.protocol !== 'https:' && !fixture) {
		return null;
	}
	if (url.pathname === '/' || url.origin === origin) {
		return null;
	}
	return url;
}

/** The client a metadata document describes, if it describes one this server can serve. */
export function readDocument(body: string, clientId: string): Client | null {
	let document: unknown;
	try {
		document = JSON.parse(body);
	} catch {
		return null;
	}
	if (!isRecord(document) || document.client_id !== clientId) {
		return null;
	}
	const redirectUris = redirectList(document.redirect_uris);
	const method = document.token_endpoint_auth_method;
	if (redirectUris === null || (method !== undefined && method !== 'none')) {
		return null;
	}
	if (!offers(document.grant_types, 'authorization_code')) {
		return null;
	}
	if (!offers(document.response_types, 'code')) {
		return null;
	}
	const { host } = new URL(clientId);
	return { id: clientId, name: displayName(document.client_name) ?? host, host, redirectUris };
}

/** Seconds a fetched document stays fresh, from its Cache-Control. */
export function freshness(cacheControl: string | undefined): number {
	const directives = (cacheControl ?? '').toLowerCase();
	if (/\b(?:no-store|no-cache)\b/u.test(directives)) {
		return 0;
	}
	const maxAge = /\bmax-age=(\d+)/u.exec(directives);
	return maxAge === null ? DEFAULT_FRESH_S : Math.min(Number(maxAge[1]), MAX_FRESH_S);
}

const documents = new Map<string, { client: Client; until: number }>();

export function forgetDocuments(): void {
	documents.clear();
}

async function fetchDocument(url: URL, clientId: string): Promise<ClientLookup> {
	const cached = documents.get(clientId);
	if (cached !== undefined && cached.until > Date.now()) {
		return { ok: true, client: cached.client };
	}
	documents.delete(clientId);

	let status: number;
	let body: string;
	let cacheControl: string | undefined;
	try {
		const answer = await guardedFetch(url, DOCUMENT_BUDGET);
		status = answer.status;
		body = answer.body.toString('utf8');
		cacheControl = answer.headers['cache-control'];
	} catch (error) {
		const transient =
			error instanceof FetchRefused && (error.reason === 'timeout' || error.reason === 'network');
		return { ok: false, unreachable: transient };
	}
	if (status !== 200) {
		return { ok: false, unreachable: status >= 500 };
	}
	const client = readDocument(body, clientId);
	if (client === null) {
		return { ok: false, unreachable: false };
	}

	const fresh = freshness(cacheControl);
	if (fresh > 0) {
		if (documents.size >= MAX_CACHED) {
			const oldest = documents.keys().next().value;
			if (oldest !== undefined) documents.delete(oldest);
		}
		documents.set(clientId, { client, until: Date.now() + fresh * 1000 });
	}
	return { ok: true, client };
}

/** Who a `client_id` is: a metadata document it names, or a registration made here. */
export async function resolveClient(
	db: Database,
	clientId: string,
	origin: string
): Promise<ClientLookup> {
	if (/^https?:/iu.test(clientId)) {
		const url = metadataUrl(clientId, origin);
		return url === null ? { ok: false, unreachable: false } : fetchDocument(url, clientId);
	}
	const row = db.select().from(oauthClients).where(eq(oauthClients.id, clientId)).get();
	if (row === undefined) {
		return { ok: false, unreachable: false };
	}
	return {
		ok: true,
		client: { id: row.id, name: row.name, host: null, redirectUris: row.redirectUris }
	};
}

export type Registration =
	| { ok: true; metadata: Record<string, unknown> }
	| { ok: false; error: 'invalid_redirect_uri' | 'invalid_client_metadata'; description: string };

/** Dynamic Client Registration (RFC 7591): public clients only, whatever method they asked for. */
export function registerClient(
	db: Database,
	body: Record<string, unknown>,
	now = new Date()
): Registration {
	const redirectUris = redirectList(body.redirect_uris);
	if (redirectUris === null) {
		return {
			ok: false,
			error: 'invalid_redirect_uri',
			description: `redirect_uris must list 1 to ${MAX_REDIRECTS} https or loopback http URIs without a fragment`
		};
	}
	if (!offers(body.grant_types, 'authorization_code') || !offers(body.response_types, 'code')) {
		return {
			ok: false,
			error: 'invalid_client_metadata',
			description: 'this server grants authorization_code with response type code only'
		};
	}

	// A registration no consent ever used is dropped after a day: anyone may register.
	db.delete(oauthClients)
		.where(
			and(
				lt(oauthClients.createdAt, new Date(now.getTime() - DAY_MS)),
				notExists(
					db
						.select({ id: oauthGrants.id })
						.from(oauthGrants)
						.where(eq(oauthGrants.clientId, oauthClients.id))
				)
			)
		)
		.run();

	const id = `tc_${randomBytes(16).toString('base64url')}`;
	const name = displayName(body.client_name) ?? new URL(redirectUris[0]).hostname;
	db.insert(oauthClients).values({ id, name, redirectUris, createdAt: now }).run();

	return {
		ok: true,
		metadata: {
			client_id: id,
			client_id_issued_at: Math.floor(now.getTime() / 1000),
			client_name: name,
			redirect_uris: redirectUris,
			grant_types: ['authorization_code', 'refresh_token'],
			response_types: ['code'],
			token_endpoint_auth_method: 'none'
		}
	};
}
