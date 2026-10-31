import { request, setDeviceToken } from './api.ts';

export type Account = { id: string; email: string; createdAt: number; hasPassword: boolean };

export type PublicToken = {
	id: string;
	label: string;
	kind: 'web' | 'device' | 'api';
	prefix: string;
	createdAt: number;
	lastUsedAt: number | null;
	current: boolean;
};

export type AuthConfig = { signUp: boolean; google: boolean; emailDelivers: boolean };

export type Lookup = {
	exists: boolean;
	verified: boolean;
	hasPassword: boolean;
	hasGoogle: boolean;
};

type Proof = { droppedPassword: boolean; token?: string };

function clientFields(): Record<string, string> {
	return import.meta.env.APP_BUILD
		? { client: 'device', label: 'Torsel on Android' }
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
	await request<unknown>('/api/auth/login-link', { method: 'POST', body: { email, to } });
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
	label: string
): Promise<{ token: string; credential: PublicToken }> {
	return request('/api/auth/tokens', { method: 'POST', body: { label } });
}

export async function revokeToken(id: string): Promise<void> {
	await request<undefined>(`/api/auth/tokens/${id}`, { method: 'DELETE' });
}
