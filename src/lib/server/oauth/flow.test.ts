import { createHash, randomBytes } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { insertUser, revokeOtherTokens } from '../auth/accounts.ts';
import { resolveCredential } from '../auth/session.ts';
import type { Database } from '../db/client.ts';
import { createDatabase } from '../db/client.ts';
import { runMigrations } from '../db/migrate.ts';
import { authTokens, oauthClients, oauthGrants } from '../db/schema.ts';
import { registerClient } from './clients.ts';
import type { Access } from './flow.ts';
import {
	authorize,
	decide,
	exchange,
	listGrants,
	pendingRequest,
	purgeExpired,
	revoke,
	revokeGrant
} from './flow.ts';
import { redirectMatches, validRedirect } from './redirects.ts';

const ORIGIN = 'https://torsel.test';
const RESOURCE = `${ORIGIN}/api/mcp`;
const LOOPBACK = 'http://127.0.0.1/callback';
const WEB = 'https://agent.example/oauth/back';

let db: Database;
let userId: string;
let clientId: string;

function pkce(): { verifier: string; challenge: string } {
	const verifier = randomBytes(32).toString('base64url');
	return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

function params(fields: Record<string, string | null>): URLSearchParams {
	const search = new URLSearchParams();
	for (const [name, value] of Object.entries(fields)) {
		if (value !== null) search.set(name, value);
	}
	return search;
}

function authorizeParams(
	challenge: string,
	overrides: Record<string, string | null> = {}
): URLSearchParams {
	return params({
		response_type: 'code',
		client_id: clientId,
		redirect_uri: WEB,
		code_challenge: challenge,
		code_challenge_method: 'S256',
		state: 'opaque-state',
		resource: RESOURCE,
		scope: 'read write',
		...overrides
	});
}

async function pendingId(challenge: string, overrides = {}): Promise<string> {
	const outcome = await authorize(db, authorizeParams(challenge, overrides), ORIGIN);
	if (outcome.kind !== 'consent') throw new Error(`no consent: ${JSON.stringify(outcome)}`);
	return outcome.id;
}

async function codeFor(
	challenge: string,
	access: Access = 'write',
	overrides = {}
): Promise<{ code: string; back: URL }> {
	const id = await pendingId(challenge, overrides);
	const location = decide(db, id, userId, { allow: true, access }, ORIGIN);
	if (location === null) throw new Error('not decided');
	const back = new URL(location);
	return { code: back.searchParams.get('code') ?? '', back };
}

function trade(code: string, verifier: string, overrides: Record<string, string | null> = {}) {
	return exchange(
		db,
		params({
			grant_type: 'authorization_code',
			code,
			client_id: clientId,
			redirect_uri: WEB,
			code_verifier: verifier,
			resource: RESOURCE,
			...overrides
		})
	);
}

function refresh(token: string, overrides: Record<string, string | null> = {}) {
	return exchange(
		db,
		params({ grant_type: 'refresh_token', refresh_token: token, client_id: clientId, ...overrides })
	);
}

async function connected(access: Access = 'write') {
	const { verifier, challenge } = pkce();
	const { code } = await codeFor(challenge, access);
	const answer = trade(code, verifier);
	expect(answer.status).toBe(200);
	return answer.body as { access_token: string; refresh_token: string; scope: string };
}

beforeEach(() => {
	db = createDatabase(':memory:');
	runMigrations(db);
	userId = insertUser(db, { email: 'me@example.com' }).id;
	const registration = registerClient(db, {
		client_name: 'Agent',
		redirect_uris: [WEB, LOOPBACK]
	});
	if (!registration.ok) throw new Error('no client');
	clientId = String(registration.metadata.client_id);
});

describe('redirect URIs', () => {
	it('must be https, or http on loopback, without a fragment', () => {
		expect(validRedirect('https://claude.ai/api/mcp/auth_callback')).toBe(true);
		expect(validRedirect('http://localhost:8787/callback')).toBe(true);
		expect(validRedirect('http://[::1]/cb')).toBe(true);
		expect(validRedirect('http://agent.example/cb')).toBe(false);
		expect(validRedirect('https://agent.example/cb#frag')).toBe(false);
		expect(validRedirect('cursor://callback')).toBe(false);
		expect(validRedirect('javascript:alert(1)')).toBe(false);
		expect(validRedirect('https://user:pw@agent.example/cb')).toBe(false);
	});

	it('match exactly, except a loopback port', () => {
		const registered = ['http://localhost/callback', 'https://agent.example/cb'];
		expect(redirectMatches(registered, 'http://localhost:54321/callback')).toBe(true);
		expect(redirectMatches(registered, 'https://agent.example/cb')).toBe(true);
		expect(redirectMatches(registered, 'https://agent.example:8443/cb')).toBe(false);
		expect(redirectMatches(registered, 'https://agent.example/cb/')).toBe(false);
		expect(redirectMatches(registered, 'https://agent.example/cb?x=1')).toBe(false);
		expect(redirectMatches(registered, 'http://localhost:1/other')).toBe(false);
		expect(redirectMatches(registered, 'http://127.0.0.1:54321/callback')).toBe(false);
	});
});

describe('the authorization endpoint', () => {
	it('shows an unknown client or redirect here instead of redirecting', async () => {
		const { challenge } = pkce();
		expect(
			await authorize(db, authorizeParams(challenge, { client_id: 'tc_nope' }), ORIGIN)
		).toEqual({ kind: 'refuse', reason: 'client' });
		expect(await authorize(db, authorizeParams(challenge, { client_id: null }), ORIGIN)).toEqual({
			kind: 'refuse',
			reason: 'client'
		});
		expect(
			await authorize(
				db,
				authorizeParams(challenge, { redirect_uri: 'https://evil.example/cb' }),
				ORIGIN
			)
		).toEqual({ kind: 'refuse', reason: 'redirect' });
		expect(await authorize(db, authorizeParams(challenge, { redirect_uri: null }), ORIGIN)).toEqual(
			{ kind: 'refuse', reason: 'redirect' }
		);
	});

	it('requires PKCE with S256, and says so to the client with state and iss', async () => {
		const { challenge } = pkce();
		const variants: Record<string, string | null>[] = [
			{ code_challenge: null },
			{ code_challenge_method: 'plain' },
			{ code_challenge_method: null },
			{ code_challenge: 'too-short' }
		];
		for (const overrides of variants) {
			const outcome = await authorize(db, authorizeParams(challenge, overrides), ORIGIN);
			expect(outcome.kind).toBe('redirect');
			const back = new URL(outcome.kind === 'redirect' ? outcome.location : '');
			expect(back.origin + back.pathname).toBe(WEB);
			expect(back.searchParams.get('error')).toBe('invalid_request');
			expect(back.searchParams.get('state')).toBe('opaque-state');
			expect(back.searchParams.get('iss')).toBe(ORIGIN);
		}
	});

	it('takes only the code response type', async () => {
		const { challenge } = pkce();
		const outcome = await authorize(
			db,
			authorizeParams(challenge, { response_type: 'token' }),
			ORIGIN
		);
		expect(outcome.kind === 'redirect' && new URL(outcome.location).searchParams.get('error')).toBe(
			'unsupported_response_type'
		);
	});

	it('refuses a resource other than this server (RFC 8707), and reads none as this one', async () => {
		const { challenge } = pkce();
		const outcome = await authorize(
			db,
			authorizeParams(challenge, { resource: 'https://other.example/mcp' }),
			ORIGIN
		);
		expect(outcome.kind === 'redirect' && new URL(outcome.location).searchParams.get('error')).toBe(
			'invalid_target'
		);
		expect((await authorize(db, authorizeParams(challenge, { resource: null }), ORIGIN)).kind).toBe(
			'consent'
		);
	});

	it('refuses a parameter given twice', async () => {
		const { challenge } = pkce();
		const repeated = authorizeParams(challenge);
		repeated.append('scope', 'write');
		const outcome = await authorize(db, repeated, ORIGIN);
		expect(outcome.kind === 'redirect' && new URL(outcome.location).searchParams.get('error')).toBe(
			'invalid_request'
		);
	});

	it('shows the consent the client name and its redirect host', async () => {
		const { challenge } = pkce();
		const id = await pendingId(challenge, { redirect_uri: 'http://127.0.0.1:5555/callback' });
		expect(pendingRequest(db, id)).toEqual({
			clientName: 'Agent',
			clientHost: null,
			redirectHost: '127.0.0.1',
			loopbackOnly: false,
			access: 'write'
		});
	});
});

describe('the consent', () => {
	it('returns a code with state and iss, once', async () => {
		const { challenge } = pkce();
		const id = await pendingId(challenge);
		const location = decide(db, id, userId, { allow: true, access: 'write' }, ORIGIN);
		const back = new URL(location ?? '');
		expect(back.searchParams.get('code')).toMatch(/^[\w-]{43}$/u);
		expect(back.searchParams.get('state')).toBe('opaque-state');
		expect(back.searchParams.get('iss')).toBe(ORIGIN);
		expect(decide(db, id, userId, { allow: true, access: 'write' }, ORIGIN)).toBeNull();
		expect(pendingRequest(db, id)).toBeNull();
	});

	it('tells the client when the person declines', async () => {
		const { challenge } = pkce();
		const id = await pendingId(challenge);
		const back = new URL(decide(db, id, userId, { allow: false, access: 'write' }, ORIGIN) ?? '');
		expect(back.searchParams.get('error')).toBe('access_denied');
		expect(back.searchParams.get('code')).toBeNull();
	});

	it('expires after ten minutes', async () => {
		const { challenge } = pkce();
		const id = await pendingId(challenge);
		const later = new Date(Date.now() + 11 * 60 * 1000);
		expect(pendingRequest(db, id, later)).toBeNull();
		expect(decide(db, id, userId, { allow: true, access: 'write' }, ORIGIN, later)).toBeNull();
	});

	it('narrows to read only on the switch, and never widens a read request', async () => {
		expect((await connected('read')).scope).toBe('read');
		const { verifier, challenge } = pkce();
		const { code } = await codeFor(challenge, 'write', { scope: 'read' });
		expect(trade(code, verifier).body.scope).toBe('read');
	});
});

describe('the code', () => {
	it('needs the PKCE verifier that matches its challenge', async () => {
		const { verifier, challenge } = pkce();
		const { code } = await codeFor(challenge);
		expect(trade(code, pkce().verifier).body.error).toBe('invalid_grant');
		expect(trade(code, verifier).body.error).toBe('invalid_grant');
	});

	it('is bound to its client, redirect and resource', async () => {
		for (const [overrides, error] of [
			[{ client_id: 'tc_other' }, 'invalid_grant'],
			[{ redirect_uri: LOOPBACK }, 'invalid_grant'],
			[{ resource: 'https://other.example/mcp' }, 'invalid_target']
		] as const) {
			const { verifier, challenge } = pkce();
			const { code } = await codeFor(challenge);
			expect(trade(code, verifier, overrides).body.error).toBe(error);
		}
	});

	it('works once, and a second use revokes what the first issued', async () => {
		const { verifier, challenge } = pkce();
		const { code } = await codeFor(challenge);
		const first = trade(code, verifier);
		expect(first.status).toBe(200);
		const { access_token: bearer } = first.body as { access_token: string };
		expect(resolveCredential(db, bearer)).not.toBeNull();

		expect(trade(code, verifier).body.error).toBe('invalid_grant');
		expect(resolveCredential(db, bearer)).toBeNull();
		expect(listGrants(db, userId)).toEqual([]);
	});

	it('lives sixty seconds', async () => {
		const { verifier, challenge } = pkce();
		const { code } = await codeFor(challenge);
		const later = new Date(Date.now() + 61 * 1000);
		const answer = exchange(
			db,
			params({
				grant_type: 'authorization_code',
				code,
				client_id: clientId,
				redirect_uri: WEB,
				code_verifier: verifier
			}),
			later
		);
		expect(answer.body.error).toBe('invalid_grant');
	});
});

describe('the tokens', () => {
	it('give a one-hour bearer bound to the MCP resource, and a refresh token', async () => {
		const answer = await connected();
		expect(answer).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'read write' });
		const credential = resolveCredential(db, answer.access_token);
		expect(credential?.token).toMatchObject({ kind: 'oauth', access: 'write', resource: RESOURCE });
		const expires = credential?.token.expiresAt?.getTime() ?? 0;
		expect(Math.abs(expires - Date.now() - 3600_000)).toBeLessThan(5000);
		expect(resolveCredential(db, answer.refresh_token)).toBeNull();
	});

	it('rotate on refresh: a fresh pair, the old refresh token spent', async () => {
		const first = await connected();
		const second = refresh(first.refresh_token);
		expect(second.status).toBe(200);
		const pair = second.body as { access_token: string; refresh_token: string };
		expect(pair.refresh_token).not.toBe(first.refresh_token);
		expect(resolveCredential(db, pair.access_token)).not.toBeNull();
		expect(refresh(pair.refresh_token).status).toBe(200);
	});

	it('revoke the whole grant when a spent refresh token comes back', async () => {
		const first = await connected();
		const pair = refresh(first.refresh_token).body as {
			access_token: string;
			refresh_token: string;
		};

		const replay = refresh(first.refresh_token);
		expect(replay).toEqual({
			status: 400,
			body: { error: 'invalid_grant', error_description: 'the refresh token was already used' }
		});
		expect(resolveCredential(db, pair.access_token)).toBeNull();
		expect(refresh(pair.refresh_token).body.error).toBe('invalid_grant');
		expect(listGrants(db, userId)).toEqual([]);
	});

	it('refuse a refresh token from another client, for another resource, or past its life', async () => {
		const first = await connected();
		expect(refresh(first.refresh_token, { client_id: 'tc_other' }).body.error).toBe(
			'invalid_grant'
		);
		expect(refresh(first.refresh_token, { resource: 'https://other.example/mcp' }).body.error).toBe(
			'invalid_target'
		);
		expect(refresh('tsr_unknown').body.error).toBe('invalid_grant');
		const later = new Date(Date.now() + 61 * 24 * 60 * 60 * 1000);
		const expired = exchange(
			db,
			params({
				grant_type: 'refresh_token',
				refresh_token: first.refresh_token,
				client_id: clientId
			}),
			later
		);
		expect(expired.body.error).toBe('invalid_grant');
	});

	it('never widen a read-only grant on refresh', async () => {
		const first = await connected('read');
		expect(refresh(first.refresh_token, { scope: 'read write' }).body.error).toBe('invalid_scope');
		expect(refresh(first.refresh_token, { scope: 'read' }).body.scope).toBe('read');
	});

	it('answer an unknown grant type or a missing field in the OAuth error shape', () => {
		expect(exchange(db, params({ grant_type: 'password' })).body.error).toBe(
			'unsupported_grant_type'
		);
		expect(exchange(db, params({})).body.error).toBe('invalid_request');
		expect(exchange(db, params({ grant_type: 'authorization_code' })).body.error).toBe(
			'invalid_request'
		);
	});
});

describe('revocation', () => {
	it('drops an access token alone, and a refresh token with its whole grant', async () => {
		const answer = await connected();
		expect(revoke(db, params({ token: answer.access_token, client_id: clientId })).status).toBe(
			200
		);
		expect(resolveCredential(db, answer.access_token)).toBeNull();
		expect(refresh(answer.refresh_token).status).toBe(200);

		const other = await connected();
		revoke(db, params({ token: other.refresh_token, client_id: clientId }));
		expect(refresh(other.refresh_token).body.error).toBe('invalid_grant');
	});

	it("leaves another client's token alone", async () => {
		const answer = await connected();
		revoke(db, params({ token: answer.access_token, client_id: 'tc_other' }));
		expect(resolveCredential(db, answer.access_token)).not.toBeNull();
	});

	it('happens from Settings, and on a password change', async () => {
		const answer = await connected();
		const [grant] = listGrants(db, userId);
		expect(grant).toMatchObject({ clientName: 'Agent', clientHost: null, access: 'write' });
		expect(revokeGrant(db, 'someone-else', grant.id)).toBe(false);
		expect(revokeGrant(db, userId, grant.id)).toBe(true);
		expect(resolveCredential(db, answer.access_token)).toBeNull();

		const next = await connected();
		revokeOtherTokens(db, userId, null);
		expect(refresh(next.refresh_token).body.error).toBe('invalid_grant');
	});
});

describe('purging', () => {
	it('keeps live grants, drops expired tokens and stale registrations', async () => {
		const answer = await connected();
		purgeExpired(db);
		expect(resolveCredential(db, answer.access_token)).not.toBeNull();
		expect(listGrants(db, userId)).toHaveLength(1);

		const later = new Date(Date.now() + 61 * 24 * 60 * 60 * 1000);
		purgeExpired(db, later);
		expect(listGrants(db, userId)).toEqual([]);
		expect(db.select().from(authTokens).where(eq(authTokens.kind, 'oauth')).all()).toEqual([]);

		registerClient(db, { redirect_uris: [WEB] }, later);
		expect(
			db
				.select()
				.from(oauthClients)
				.all()
				.map(({ id }) => id)
		).not.toContain(clientId);
	});

	it('keeps a registration a grant still uses', async () => {
		await connected();
		const later = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
		registerClient(db, { redirect_uris: [WEB] }, later);
		expect(
			db
				.select()
				.from(oauthClients)
				.all()
				.map(({ id }) => id)
		).toContain(clientId);
		expect(db.select().from(oauthGrants).all()).toHaveLength(1);
	});
});
