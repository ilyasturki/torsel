import { error, json } from '@sveltejs/kit';

import { issueToken, listTokens } from '#lib/server/auth/accounts.ts';
import { getDatabase } from '#lib/server/db/client.ts';
import { readJsonBody, requiredString } from '#lib/server/http/body.ts';
import { requireCredential } from '#lib/server/http/guards.ts';
import { publicToken } from '#lib/server/http/shapes.ts';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals }) => {
	const { user, token } = requireCredential(locals);

	return json(
		listTokens(getDatabase(), user.id).map((record) => publicToken(record, record.id === token.id))
	);
};

const DAY_MS = 24 * 60 * 60 * 1000;

const MAX_DAYS = 3650;

function readAccess(body: Record<string, unknown>): 'read' | 'write' {
	const { access } = body;
	if (access === undefined || access === 'write' || access === 'read') {
		return access ?? 'write';
	}
	error(400, 'access must be one of: read, write');
}

function readExpiry(body: Record<string, unknown>): Date | null {
	const days = body.expiresInDays;
	if (days === undefined || days === null) {
		return null;
	}
	if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
		error(400, `expiresInDays must be a whole number from 1 to ${MAX_DAYS}`);
	}
	return new Date(Date.now() + days * DAY_MS);
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const { user } = requireCredential(locals);

	const body = await readJsonBody(request);
	const { token, record } = issueToken(
		getDatabase(),
		user.id,
		requiredString(body, 'label'),
		'api',
		readExpiry(body),
		readAccess(body)
	);

	return json({ token, credential: publicToken(record, false) }, { status: 201 });
};
