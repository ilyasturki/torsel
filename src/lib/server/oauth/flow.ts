import { randomBytes } from 'node:crypto';

import { and, eq, gt, isNull, lt, notExists } from 'drizzle-orm';

import { hashToken, mintToken } from '../auth/tokens.ts';
import type { Database } from '../db/client.ts';
import type { OAuthGrant } from '../db/schema.ts';
import { authTokens, oauthGrants, oauthRefreshTokens, oauthRequests } from '../db/schema.ts';
import { resolveClient } from './clients.ts';
import { mcpResource } from './metadata.ts';
import { CHALLENGE, verifierMatches } from './pkce.ts';
import { isLoopback, redirectMatches } from './redirects.ts';

export type Access = 'read' | 'write';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const REQUEST_TTL_MS = 10 * MINUTE_MS;
const CODE_TTL_MS = MINUTE_MS;
const ACCESS_TTL_MS = HOUR_MS;
const REFRESH_TTL_MS = 60 * DAY_MS;

const MAX_STATE = 2000;

/** `read` when only `read` was asked for; anything else, nothing included, means both. */
export function requestedAccess(scope: string | null): Access {
	const scopes = new Set((scope ?? '').split(' ').filter((part) => part !== ''));
	return scopes.has('read') && !scopes.has('write') ? 'read' : 'write';
}

export function scopeOf(access: Access): string {
	return access === 'read' ? 'read' : 'read write';
}

function narrower(a: Access, b: Access): Access {
	return a === 'read' || b === 'read' ? 'read' : 'write';
}

function sameResource(given: string, expected: string): boolean {
	return given === expected || given === `${expected}/`;
}

function secret(): string {
	return randomBytes(32).toString('base64url');
}

/** Where the person's browser goes back to the client, with the answer, `state` and `iss` (RFC 9207). */
export function clientRedirect(
	redirectUri: string,
	origin: string,
	state: string | null,
	fields: Record<string, string>
): string {
	const url = new URL(redirectUri);
	for (const [name, value] of Object.entries(fields)) {
		url.searchParams.set(name, value);
	}
	if (state !== null) {
		url.searchParams.set('state', state);
	}
	url.searchParams.set('iss', origin);
	return url.href;
}

export type Refusal = 'client' | 'unreachable' | 'redirect';

export type Authorization =
	| { kind: 'consent'; id: string }
	| { kind: 'refuse'; reason: Refusal }
	| { kind: 'redirect'; location: string };

/** Drops what can no longer be used: expired requests, codes, tokens, and grants with no live refresh token. */
export function purgeExpired(db: Database, now = new Date()): void {
	db.delete(oauthRequests)
		.where(lt(oauthRequests.expiresAt, new Date(now.getTime() - DAY_MS)))
		.run();
	db.delete(oauthRefreshTokens).where(lt(oauthRefreshTokens.expiresAt, now)).run();
	db.delete(authTokens)
		.where(and(eq(authTokens.kind, 'oauth'), lt(authTokens.expiresAt, now)))
		.run();
	db.delete(oauthGrants)
		.where(
			notExists(
				db
					.select({ grantId: oauthRefreshTokens.grantId })
					.from(oauthRefreshTokens)
					.where(
						and(eq(oauthRefreshTokens.grantId, oauthGrants.id), isNull(oauthRefreshTokens.usedAt))
					)
			)
		)
		.run();
}

/**
 * The authorization endpoint. Until the client and its redirect check out, a failure is shown
 * here, never sent anywhere; after that, it goes back to the client.
 */
export async function authorize(
	db: Database,
	params: URLSearchParams,
	origin: string,
	now = new Date()
): Promise<Authorization> {
	const single = (name: string): string | null =>
		params.getAll(name).length === 1 ? params.get(name) : null;
	const repeated = [...new Set(params.keys())].some((name) => params.getAll(name).length > 1);

	const clientId = single('client_id');
	if (clientId === null || clientId === '') {
		return { kind: 'refuse', reason: 'client' };
	}
	const lookup = await resolveClient(db, clientId, origin);
	if (!lookup.ok) {
		return { kind: 'refuse', reason: lookup.unreachable ? 'unreachable' : 'client' };
	}
	const { client } = lookup;

	const redirectUri = single('redirect_uri');
	if (redirectUri === null || !redirectMatches(client.redirectUris, redirectUri)) {
		return { kind: 'refuse', reason: 'redirect' };
	}

	const state = single('state');
	const back = (error: string, description: string): Authorization => ({
		kind: 'redirect',
		location: clientRedirect(redirectUri, origin, state, {
			error,
			error_description: description
		})
	});

	if (repeated) {
		return back('invalid_request', 'a parameter appears more than once');
	}
	if (single('response_type') !== 'code') {
		return back('unsupported_response_type', 'response_type must be code');
	}
	const challenge = single('code_challenge');
	if (single('code_challenge_method') !== 'S256' || challenge === null) {
		return back('invalid_request', 'PKCE with code_challenge_method S256 is required');
	}
	if (!CHALLENGE.test(challenge)) {
		return back('invalid_request', 'code_challenge must be an unpadded base64url SHA-256');
	}
	if (state !== null && state.length > MAX_STATE) {
		return back('invalid_request', 'state is too long');
	}
	const resource = mcpResource(origin);
	const asked = single('resource');
	// A client that names no resource can only mean the one this server has.
	if (asked !== null && !sameResource(asked, resource)) {
		return back('invalid_target', `the only resource here is ${resource}`);
	}

	purgeExpired(db, now);
	const id = secret();
	db.insert(oauthRequests)
		.values({
			id,
			clientId: client.id,
			clientName: client.name,
			clientHost: client.host,
			redirectUri,
			loopbackOnly: client.redirectUris.every(isLoopback),
			state,
			codeChallenge: challenge,
			resource,
			access: requestedAccess(single('scope')),
			expiresAt: new Date(now.getTime() + REQUEST_TTL_MS)
		})
		.run();
	return { kind: 'consent', id };
}

export type Pending = {
	clientName: string;
	clientHost: string | null;
	redirectHost: string;
	loopbackOnly: boolean;
	access: Access;
};

/** What the consent page shows, while the request waits for a decision. */
export function pendingRequest(db: Database, id: string, now = new Date()): Pending | null {
	const row = db
		.select()
		.from(oauthRequests)
		.where(
			and(
				eq(oauthRequests.id, id),
				isNull(oauthRequests.decidedAt),
				gt(oauthRequests.expiresAt, now)
			)
		)
		.get();
	if (row === undefined) {
		return null;
	}
	return {
		clientName: row.clientName,
		clientHost: row.clientHost,
		redirectHost: new URL(row.redirectUri).hostname,
		loopbackOnly: row.loopbackOnly,
		access: row.access
	};
}

/** The person's answer: a code for the client, or its refusal. Null once decided or expired. */
export function decide(
	db: Database,
	id: string,
	userId: string,
	decision: { allow: boolean; access: Access },
	origin: string,
	now = new Date()
): string | null {
	const code = secret();
	const open = and(
		eq(oauthRequests.id, id),
		isNull(oauthRequests.decidedAt),
		gt(oauthRequests.expiresAt, now)
	);
	return db.transaction((tx) => {
		const row = tx.select().from(oauthRequests).where(open).get();
		if (row === undefined) {
			return null;
		}
		if (!decision.allow) {
			tx.update(oauthRequests).set({ decidedAt: now }).where(eq(oauthRequests.id, id)).run();
			return clientRedirect(row.redirectUri, origin, row.state, {
				error: 'access_denied',
				error_description: 'the person declined'
			});
		}
		tx.update(oauthRequests)
			.set({
				decidedAt: now,
				userId,
				access: narrower(row.access, decision.access),
				codeHash: hashToken(code),
				expiresAt: new Date(now.getTime() + CODE_TTL_MS)
			})
			.where(eq(oauthRequests.id, id))
			.run();
		return clientRedirect(row.redirectUri, origin, row.state, { code });
	});
}

export type TokenAnswer = { status: number; body: Record<string, unknown> };

function failure(error: string, description: string, status = 400): TokenAnswer {
	return { status, body: { error, error_description: description } };
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

function issue(tx: Tx, grant: OAuthGrant, access: Access, now: Date): TokenAnswer {
	const bearer = mintToken();
	const refresh = mintToken('tsr_');
	tx.insert(authTokens)
		.values({
			id: crypto.randomUUID(),
			userId: grant.userId,
			label: grant.clientName,
			kind: 'oauth',
			access,
			tokenHash: bearer.tokenHash,
			tokenPrefix: bearer.tokenPrefix,
			createdAt: now,
			expiresAt: new Date(now.getTime() + ACCESS_TTL_MS),
			grantId: grant.id,
			resource: grant.resource
		})
		.run();
	tx.insert(oauthRefreshTokens)
		.values({
			tokenHash: refresh.tokenHash,
			grantId: grant.id,
			expiresAt: new Date(now.getTime() + REFRESH_TTL_MS)
		})
		.run();
	return {
		status: 200,
		body: {
			access_token: bearer.token,
			token_type: 'Bearer',
			expires_in: ACCESS_TTL_MS / 1000,
			refresh_token: refresh.token,
			scope: scopeOf(access)
		}
	};
}

function exchangeCode(db: Database, form: URLSearchParams, now: Date): TokenAnswer {
	const code = form.get('code');
	const clientId = form.get('client_id');
	const redirectUri = form.get('redirect_uri');
	const verifier = form.get('code_verifier');
	if (code === null || clientId === null || redirectUri === null || verifier === null) {
		return failure(
			'invalid_request',
			'code, client_id, redirect_uri and code_verifier are required'
		);
	}

	return db.transaction((tx) => {
		const row = tx
			.select()
			.from(oauthRequests)
			.where(eq(oauthRequests.codeHash, hashToken(code)))
			.get();
		if (row === undefined || row.userId === null) {
			return failure('invalid_grant', 'unknown code');
		}
		if (row.usedAt !== null) {
			// RFC 6749 §4.1.2: a code used twice was stolen, so what it issued is revoked.
			if (row.grantId !== null) {
				tx.delete(oauthGrants).where(eq(oauthGrants.id, row.grantId)).run();
			}
			return failure('invalid_grant', 'the code was already used');
		}
		tx.update(oauthRequests).set({ usedAt: now }).where(eq(oauthRequests.id, row.id)).run();

		if (row.expiresAt <= now) {
			return failure('invalid_grant', 'the code expired');
		}
		if (row.clientId !== clientId) {
			return failure('invalid_grant', 'the code was issued to another client');
		}
		if (row.redirectUri !== redirectUri) {
			return failure('invalid_grant', 'redirect_uri differs from the authorization request');
		}
		if (!verifierMatches(verifier, row.codeChallenge)) {
			return failure('invalid_grant', 'code_verifier does not match the code_challenge');
		}
		const resource = form.get('resource');
		if (resource !== null && !sameResource(resource, row.resource)) {
			return failure('invalid_target', `the code is for ${row.resource}`);
		}

		const grant = tx
			.insert(oauthGrants)
			.values({
				id: crypto.randomUUID(),
				userId: row.userId,
				clientId: row.clientId,
				clientName: row.clientName,
				access: row.access,
				resource: row.resource,
				createdAt: now
			})
			.returning()
			.get();
		tx.update(oauthRequests).set({ grantId: grant.id }).where(eq(oauthRequests.id, row.id)).run();
		return issue(tx, grant, grant.access, now);
	});
}

function rotate(db: Database, form: URLSearchParams, now: Date): TokenAnswer {
	const token = form.get('refresh_token');
	const clientId = form.get('client_id');
	if (token === null || clientId === null) {
		return failure('invalid_request', 'refresh_token and client_id are required');
	}

	return db.transaction((tx) => {
		const row = tx
			.select({ refresh: oauthRefreshTokens, grant: oauthGrants })
			.from(oauthRefreshTokens)
			.innerJoin(oauthGrants, eq(oauthGrants.id, oauthRefreshTokens.grantId))
			.where(eq(oauthRefreshTokens.tokenHash, hashToken(token)))
			.get();
		if (row === undefined) {
			return failure('invalid_grant', 'unknown refresh token');
		}
		const { refresh, grant } = row;
		if (refresh.usedAt !== null) {
			// A rotated token came back: one of its two holders is not the client, so neither keeps access.
			tx.delete(oauthGrants).where(eq(oauthGrants.id, grant.id)).run();
			return failure('invalid_grant', 'the refresh token was already used');
		}
		if (refresh.expiresAt <= now) {
			return failure('invalid_grant', 'the refresh token expired');
		}
		if (grant.clientId !== clientId) {
			return failure('invalid_grant', 'the refresh token was issued to another client');
		}
		const resource = form.get('resource');
		if (resource !== null && !sameResource(resource, grant.resource)) {
			return failure('invalid_target', `the grant is for ${grant.resource}`);
		}
		const scope = form.get('scope');
		const namesAccess =
			scope !== null && scope.split(' ').some((part) => part === 'read' || part === 'write');
		const access = namesAccess ? requestedAccess(scope) : grant.access;
		if (access === 'write' && grant.access === 'read') {
			return failure('invalid_scope', 'the grant reads only');
		}

		tx.update(oauthRefreshTokens)
			.set({ usedAt: now })
			.where(eq(oauthRefreshTokens.tokenHash, refresh.tokenHash))
			.run();
		tx.delete(authTokens)
			.where(and(eq(authTokens.grantId, grant.id), lt(authTokens.expiresAt, now)))
			.run();
		return issue(tx, grant, access, now);
	});
}

/** The token endpoint (form-encoded): a code with its PKCE verifier, or a refresh token, for a fresh pair. */
export function exchange(db: Database, form: URLSearchParams, now = new Date()): TokenAnswer {
	switch (form.get('grant_type')) {
		case 'authorization_code':
			return exchangeCode(db, form, now);
		case 'refresh_token':
			return rotate(db, form, now);
		case null:
			return failure('invalid_request', 'grant_type is required');
		default:
			return failure(
				'unsupported_grant_type',
				'grant_type must be authorization_code or refresh_token'
			);
	}
}

/** RFC 7009: forgets a token if it is one of this client's; answers the same either way. */
export function revoke(db: Database, form: URLSearchParams): TokenAnswer {
	const token = form.get('token');
	if (token === null) {
		return failure('invalid_request', 'token is required');
	}
	const clientId = form.get('client_id');
	const hash = hashToken(token);
	const ours = (grant: OAuthGrant): boolean => clientId === null || grant.clientId === clientId;

	const bearer = db
		.select({ id: authTokens.id, grant: oauthGrants })
		.from(authTokens)
		.innerJoin(oauthGrants, eq(oauthGrants.id, authTokens.grantId))
		.where(eq(authTokens.tokenHash, hash))
		.get();
	if (bearer !== undefined && ours(bearer.grant)) {
		db.delete(authTokens).where(eq(authTokens.id, bearer.id)).run();
	}

	const refresh = db
		.select({ grant: oauthGrants })
		.from(oauthRefreshTokens)
		.innerJoin(oauthGrants, eq(oauthGrants.id, oauthRefreshTokens.grantId))
		.where(eq(oauthRefreshTokens.tokenHash, hash))
		.get();
	if (refresh !== undefined && ours(refresh.grant)) {
		db.delete(oauthGrants).where(eq(oauthGrants.id, refresh.grant.id)).run();
	}

	return { status: 200, body: {} };
}

export type PublicGrant = {
	id: string;
	clientName: string;
	clientHost: string | null;
	access: Access;
	createdAt: number;
	lastUsedAt: number | null;
};

export function listGrants(db: Database, userId: string): PublicGrant[] {
	return db
		.select()
		.from(oauthGrants)
		.where(eq(oauthGrants.userId, userId))
		.orderBy(oauthGrants.createdAt)
		.all()
		.map((grant) => ({
			id: grant.id,
			clientName: grant.clientName,
			clientHost: /^https?:/u.test(grant.clientId) ? new URL(grant.clientId).host : null,
			access: grant.access,
			createdAt: grant.createdAt.getTime(),
			lastUsedAt: grant.lastUsedAt === null ? null : grant.lastUsedAt.getTime()
		}));
}

/** Ends a connection: the grant, its access tokens and its refresh tokens go together. */
export function revokeGrant(db: Database, userId: string, grantId: string): boolean {
	const removed = db
		.delete(oauthGrants)
		.where(and(eq(oauthGrants.id, grantId), eq(oauthGrants.userId, userId)))
		.returning({ id: oauthGrants.id })
		.get();
	return removed !== undefined;
}
