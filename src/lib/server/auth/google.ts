import { envText } from '../env.ts';

const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const USERINFO = 'https://openidconnect.googleapis.com/v1/userinfo';

export const GOOGLE_PATH = '/api/auth/google';

export type GoogleClient = { id: string; secret: string; redirectUri: string };

export type GoogleProfile = { sub: string; email: string };

// Set by the e2e suite to its stub: the token exchange is server to server, out of a browser's reach.
function endpoints(): { authorize: string; token: string; userinfo: string } {
	const issuer = envText('TORSEL_GOOGLE_ISSUER', '');

	return issuer === ''
		? { authorize: AUTHORIZE, token: TOKEN, userinfo: USERINFO }
		: { authorize: `${issuer}/auth`, token: `${issuer}/token`, userinfo: `${issuer}/userinfo` };
}

export function authorizeUrl(client: GoogleClient, state: string): string {
	const url = new URL(endpoints().authorize);

	url.search = new URLSearchParams({
		client_id: client.id,
		redirect_uri: client.redirectUri,
		response_type: 'code',
		scope: 'openid email',
		state
	}).toString();

	return url.href;
}

/** Null unless Google vouches for the address: linking to an existing account rests on that alone. */
export async function fetchProfile(
	client: GoogleClient,
	code: string
): Promise<GoogleProfile | null> {
	const { token, userinfo } = endpoints();

	const exchanged = await fetch(token, {
		method: 'POST',
		body: new URLSearchParams({
			client_id: client.id,
			client_secret: client.secret,
			redirect_uri: client.redirectUri,
			grant_type: 'authorization_code',
			code
		}),
		signal: AbortSignal.timeout(15_000)
	});
	if (!exchanged.ok) {
		return null;
	}

	const { access_token: accessToken } = (await exchanged.json()) as { access_token?: unknown };
	if (typeof accessToken !== 'string') {
		return null;
	}

	const answered = await fetch(userinfo, {
		headers: { authorization: `Bearer ${accessToken}` },
		signal: AbortSignal.timeout(15_000)
	});
	if (!answered.ok) {
		return null;
	}

	const {
		sub,
		email,
		email_verified: verified
	} = (await answered.json()) as {
		sub?: unknown;
		email?: unknown;
		email_verified?: unknown;
	};

	if (typeof sub !== 'string' || typeof email !== 'string' || verified !== true) {
		return null;
	}

	return { sub, email };
}
