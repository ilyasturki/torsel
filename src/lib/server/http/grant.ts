import { error } from '@sveltejs/kit';
import type { Cookies } from '@sveltejs/kit';

import { issueToken } from '../auth/accounts.ts';
import type { Credential } from '../auth/session.ts';
import { SESSION_COOKIE, sessionCookieOptions, startWebSession } from '../auth/session.ts';
import type { Database } from '../db/client.ts';
import type { User } from '../db/schema.ts';
import { requiredString } from './body.ts';
import type { PublicToken } from './shapes.ts';
import { publicToken } from './shapes.ts';

export type Client = { kind: 'web' } | { kind: 'device'; label: string };

export function readClient(body: Record<string, unknown>): Client {
	const { client } = body;

	if (client !== 'web' && client !== 'device') {
		error(400, 'client must be one of: web, device');
	}

	return client === 'web'
		? { kind: 'web' }
		: { kind: 'device', label: requiredString(body, 'label') };
}

export type Grant = { kind: 'web' } | { kind: 'device'; token: string; credential: PublicToken };

export function grantCredential(
	db: Database,
	user: User,
	client: Client,
	event: { cookies: Cookies; url: URL; locals: { credential: Credential | null } }
): Grant {
	if (client.kind === 'web') {
		const { token } = startWebSession(db, user.id, event.locals.credential);
		event.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(event.url));
		return { kind: 'web' };
	}

	const { token, record } = issueToken(db, user.id, client.label, 'device');
	return { kind: 'device', token, credential: publicToken(record, false) };
}
