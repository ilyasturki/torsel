import { shell as words } from '../i18n/shell.ts';
import { request, setDeviceToken } from './api.ts';

export type Account = { id: string; email: string; createdAt: number; hasPassword: boolean };

export type PublicToken = {
	id: string;
	label: string;
	kind: 'web' | 'device' | 'api' | 'oauth';
	access: 'read' | 'write';
	prefix: string;
	createdAt: number;
	lastUsedAt: number | null;
	expiresAt: number | null;
	current: boolean;
};

export type AuthConfig = {
	signUp: boolean;
	google: boolean;
	emailDelivers: boolean;
	/** Agents can connect by signing in, with no token to copy. */
	oauth: boolean;
};

export type Lookup = {
	exists: boolean;
	verified: boolean;
	hasPassword: boolean;
	hasGoogle: boolean;
};

type Proof = { droppedPassword: boolean; token?: string };

function clientFields(): Record<string, string> {
	return import.meta.env.APP_BUILD
		? { client: 'device', label: words.androidToken }
		: { client: 'web' };
}

function adopt<T extends { token?: string }>(answer: T): T {
	if (answer.token !== undefined) {
		setDeviceToken(answer.token);
	}
	return answer;
}

export async function session(): Promise<Account | null> {
	const { user } = await request<{ user: Account | null }>('/api/auth/session');
	if (user === null) {
		setDeviceToken(null);
	}
	return user;
}

export async function authConfig(): Promise<AuthConfig> {
	return request<AuthConfig>('/api/auth/config');
}

export async function lookup(email: string): Promise<Lookup> {
	return request<Lookup>('/api/auth/lookup', { method: 'POST', body: { email } });
}

export async function login(email: string, password: string): Promise<void> {
	const answer = await request<{ token?: string } | undefined>('/api/auth/login', {
		method: 'POST',
		body: { email, password, ...clientFields() }
	});
	if (answer !== undefined) {
		adopt(answer);
	}
}

export async function signUp(
	email: string,
	password: string,
	to: string | null
): Promise<string | null> {
	const { claim } = await request<{ claim?: string }>('/api/auth/signup', {
		method: 'POST',
		body: { email, password, to, ...clientFields() }
	});
	return claim ?? null;
}

export async function requestSignInMail(email: string, to: string | null): Promise<void> {
	await request<unknown>('/api/auth/login-link', {
		method: 'POST',
		body: { email, to, ...clientFields() }
	});
}

export async function verifyCode(
	email: string,
	code: string,
	claim: string | null
): Promise<Proof> {
	return adopt(
		await request<Proof>('/api/auth/verify-code', {
			method: 'POST',
			body: { email, code, ...(claim === null ? {} : { claim }), ...clientFields() }
		})
	);
}

export async function verifyLink(token: string): Promise<Proof> {
	return request<Proof>('/api/auth/verify-link', { method: 'POST', body: { token } });
}

export async function setPassword(password: string): Promise<void> {
	await request<unknown>('/api/auth/password', { method: 'POST', body: { password } });
}

export async function logout(): Promise<void> {
	try {
		await request<undefined>('/api/auth/logout', { method: 'POST' });
	} finally {
		setDeviceToken(null);
	}
}

export async function listTokens(): Promise<PublicToken[]> {
	return request<PublicToken[]>('/api/auth/tokens');
}

export async function createToken(
	label: string,
	access: PublicToken['access'],
	expiresInDays: number | null
): Promise<{ token: string; credential: PublicToken }> {
	return request('/api/auth/tokens', {
		method: 'POST',
		body: { label, access, expiresInDays }
	});
}

export async function revokeToken(id: string): Promise<void> {
	await request<undefined>(`/api/auth/tokens/${id}`, { method: 'DELETE' });
}

export type ConnectedApp = {
	id: string;
	clientName: string;
	clientHost: string | null;
	access: 'read' | 'write';
	createdAt: number;
	lastUsedAt: number | null;
};

export async function listConnectedApps(): Promise<ConnectedApp[]> {
	return request<ConnectedApp[]>('/api/oauth/grants');
}

export async function disconnectApp(id: string): Promise<void> {
	await request<undefined>(`/api/oauth/grants/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export type PendingAuthorization = {
	clientName: string;
	clientHost: string | null;
	redirectHost: string;
	loopbackOnly: boolean;
	access: 'read' | 'write';
	email: string;
};

export async function pendingAuthorization(id: string): Promise<PendingAuthorization> {
	return request<PendingAuthorization>(`/api/oauth/requests/${encodeURIComponent(id)}`);
}

/** The person's answer; the browser then goes back to the app with it. */
export async function answerAuthorization(
	id: string,
	allow: boolean,
	access: 'read' | 'write'
): Promise<string> {
	const { redirect } = await request<{ redirect: string }>(
		`/api/oauth/requests/${encodeURIComponent(id)}`,
		{ method: 'POST', body: { allow, access } }
	);
	return redirect;
}
