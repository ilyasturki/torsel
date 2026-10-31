import type { Cookies } from '@sveltejs/kit';

import { secureCookies } from './session.ts';

const CLAIM_COOKIE = 'torsel_claim';

const VERIFY_TTL_SECONDS = 24 * 60 * 60;

export function setClaimCookie(cookies: Cookies, url: URL, nonce: string): void {
	cookies.set(CLAIM_COOKIE, nonce, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: secureCookies(url),
		maxAge: VERIFY_TTL_SECONDS
	});
}

export function takeClaimCookie(cookies: Cookies): string | null {
	const nonce = cookies.get(CLAIM_COOKIE) ?? null;
	if (nonce !== null) {
		cookies.delete(CLAIM_COOKIE, { path: '/' });
	}
	return nonce;
}
