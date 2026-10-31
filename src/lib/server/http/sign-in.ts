import { error, json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';

import { returnPath } from '../../core/return-path.ts';
import { takeClaimCookie } from '../auth/claim-cookie.ts';
import type { EmailTokenPurpose } from '../auth/email-tokens.ts';
import { issueEmailToken } from '../auth/email-tokens.ts';
import type { Proof } from '../auth/ownership.ts';
import { proveAddress } from '../auth/ownership.ts';
import { siteOrigin } from '../config.ts';
import type { Database } from '../db/client.ts';
import { deliver, passwordNoticeMail, signInMail } from '../email.ts';
import type { Client, Grant } from './grant.ts';
import { grantCredential } from './grant.ts';

export function signInLink(url: URL, token: string, to: unknown): string | null {
	const origin = siteOrigin(url);
	if (origin === null) {
		return null;
	}

	const link = new URL('/app/login/link', origin);
	link.searchParams.set('token', token);
	const path = returnPath(to);
	if (path !== null) {
		link.searchParams.set('to', path);
	}
	return link.href;
}

export async function sendSignInMail(
	db: Database,
	url: URL,
	user: { id: string; email: string },
	purpose: EmailTokenPurpose,
	to: unknown,
	client: Client['kind']
): Promise<void> {
	const { token, code } = issueEmailToken(db, user.id, purpose);
	// A link opens in the browser, signing that in rather than the device and spending the device's code.
	const link = client === 'web' ? signInLink(url, token, to) : null;
	const delivery = await deliver(signInMail(user.email, purpose, link, code));

	if (delivery === 'failed') {
		error(502, 'the email could not be sent');
	}
}

export function grantResponse(grant: Grant, droppedPassword: boolean): Response {
	return grant.kind === 'web'
		? json({ droppedPassword })
		: json({ token: grant.token, credential: grant.credential, droppedPassword }, { status: 201 });
}

/** Spends the claim, which a web client holds as a cookie and a device sends back itself. */
export function finishProof(
	db: Database,
	event: RequestEvent,
	userId: string,
	client: Client,
	bodyClaim: unknown
): Response | null {
	const cookieClaim = takeClaimCookie(event.cookies);
	const claim = typeof bodyClaim === 'string' ? bodyClaim : cookieClaim;

	const proof: Proof | null = proveAddress(db, userId, claim);
	if (proof === null) {
		return null;
	}

	if (proof.droppedPassword) {
		void deliver(passwordNoticeMail(proof.user.email, 'dropped'));
	}

	return grantResponse(grantCredential(db, proof.user, client, event), proof.droppedPassword);
}
