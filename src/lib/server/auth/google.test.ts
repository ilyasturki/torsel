import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GoogleClient } from './google.ts';
import { authorizeUrl, fetchProfile } from './google.ts';

const CLIENT: GoogleClient = {
	id: 'client',
	secret: 'secret',
	redirectUri: 'https://torsel.example/api/auth/google'
};

function google(profile: unknown, token: unknown = { access_token: 'access' }) {
	const fetchMock = vi.fn(async (url: string | URL) =>
		String(url).endsWith('/token')
			? new Response(JSON.stringify(token), { status: 200 })
			: new Response(JSON.stringify(profile), { status: 200 })
	);
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe('authorizeUrl', () => {
	it('goes to Google with the state and the pinned redirect', () => {
		const url = new URL(authorizeUrl(CLIENT, 'state-1'));

		expect(url.origin).toBe('https://accounts.google.com');
		expect(url.searchParams.get('state')).toBe('state-1');
		expect(url.searchParams.get('redirect_uri')).toBe(CLIENT.redirectUri);
		expect(url.searchParams.get('scope')).toBe('openid email');
	});
});

describe('fetchProfile', () => {
	it('returns a verified profile, sending the secret on the exchange only', async () => {
		const fetchMock = google({ sub: 'g1', email: 'me@example.com', email_verified: true });

		expect(await fetchProfile(CLIENT, 'code-1')).toEqual({ sub: 'g1', email: 'me@example.com' });

		const [, exchange] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(String(exchange.body)).toContain('client_secret=secret');
		expect(String(exchange.body)).toContain('code=code-1');
		const [, info] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
		expect(new Headers(info.headers).get('authorization')).toBe('Bearer access');
	});

	it.each([
		['false', { sub: 'g1', email: 'me@example.com', email_verified: false }],
		['absent', { sub: 'g1', email: 'me@example.com' }],
		['the string Google never sends here', { sub: 'g1', email: 'a@b.c', email_verified: 'true' }]
	])('refuses email_verified %s', async (_name, profile) => {
		google(profile);
		expect(await fetchProfile(CLIENT, 'code')).toBeNull();
	});

	it('refuses a refused exchange', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('{}', { status: 400 }))
		);
		expect(await fetchProfile(CLIENT, 'code')).toBeNull();
	});
});
