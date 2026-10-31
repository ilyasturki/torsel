import { randomBytes, timingSafeEqual } from 'node:crypto';

import { redirect } from '@sveltejs/kit';
import type { Cookies, RequestEvent } from '@sveltejs/kit';

import { normalizeEmail } from '#lib/server/auth/accounts.ts';
import { GOOGLE_PATH, authorizeUrl, fetchProfile } from '#lib/server/auth/google.ts';
import { googleAccount } from '#lib/server/auth/ownership.ts';
import { secureCookies } from '#lib/server/auth/session.ts';
import { googleClient, signUpOpen } from '#lib/server/config.ts';
import { getDatabase } from '#lib/server/db/client.ts';
import { deliver, passwordNoticeMail } from '#lib/server/email.ts';
import { grantCredential } from '#lib/server/http/grant.ts';
import { returnPath, returnTarget, signInPath } from '#lib/core/return-path.ts';

import type { RequestHandler } from './$types';

const STATE_COOKIE = 'torsel_google_state';
const RETURN_COOKIE = 'torsel_google_return';
const ROUND_TRIP_SECONDS = 10 * 60;

function setShortCookie(cookies: Cookies, url: URL, name: string, value: string): void {
	cookies.set(name, value, {
		path: GOOGLE_PATH,
		httpOnly: true,
		sameSite: 'lax',
		secure: secureCookies(url),
		maxAge: ROUND_TRIP_SECONDS
	});
}

function failed(path: string | null, reason: 'google' | 'google-closed'): never {
	const back = signInPath(path);
	redirect(303, `${back}${back.includes('?') ? '&' : '?'}error=${reason}`);
}

function sameState(sent: string | null, kept: string | undefined): boolean {
	if (sent === null || kept === undefined || sent.length !== kept.length) {
		return false;
	}
	return timingSafeEqual(Buffer.from(sent), Buffer.from(kept));
}

async function callback(event: RequestEvent, code: string): Promise<never> {
	const { cookies, url } = event;
	const kept = cookies.get(STATE_COOKIE);
	const path = returnPath(cookies.get(RETURN_COOKIE));
	cookies.delete(STATE_COOKIE, { path: GOOGLE_PATH });
	cookies.delete(RETURN_COOKIE, { path: GOOGLE_PATH });

	const client = googleClient(url);
	if (client === null || !sameState(url.searchParams.get('state'), kept)) {
		failed(path, 'google');
	}

	const profile = await fetchProfile(client, code).catch((error: unknown) => {
		console.error('google sign-in failed:', error);
		return null;
	});
	if (profile === null) {
		failed(path, 'google');
	}

	const db = getDatabase();
	const result = googleAccount(db, normalizeEmail(profile.email), profile.sub, signUpOpen());
	if (result.outcome !== 'signed-in') {
		failed(path, result.outcome === 'closed' ? 'google-closed' : 'google');
	}

	if (result.droppedPassword) {
		void deliver(passwordNoticeMail(result.user.email, 'dropped'));
	}

	grantCredential(db, result.user, { kind: 'web' }, event);
	redirect(303, returnTarget(path));
}

export const GET: RequestHandler = (event) => {
	const { cookies, url } = event;
	const code = url.searchParams.get('code');

	if (code !== null) {
		return callback(event, code);
	}
	if (url.searchParams.has('error') || url.searchParams.has('state')) {
		const path = returnPath(cookies.get(RETURN_COOKIE));
		cookies.delete(STATE_COOKIE, { path: GOOGLE_PATH });
		cookies.delete(RETURN_COOKIE, { path: GOOGLE_PATH });
		failed(path, 'google');
	}

	const client = googleClient(url);
	const path = returnPath(url.searchParams.get('to'));
	if (client === null) {
		failed(path, 'google');
	}

	const state = randomBytes(32).toString('base64url');
	setShortCookie(cookies, url, STATE_COOKIE, state);
	if (path === null) {
		cookies.delete(RETURN_COOKIE, { path: GOOGLE_PATH });
	} else {
		setShortCookie(cookies, url, RETURN_COOKIE, path);
	}

	redirect(303, authorizeUrl(client, state), { external: true });
};
