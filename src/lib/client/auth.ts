import { request, setDeviceToken } from './api.ts';

export type Account = { id: string; email: string; createdAt: number };

export type PublicToken = {
	id: string;
	label: string;
	kind: 'web' | 'device' | 'api';
	prefix: string;
	createdAt: number;
	lastUsedAt: number | null;
	current: boolean;
};

export async function session(): Promise<Account> {
	const { user } = await request<{ user: Account }>('/api/auth/session');
	return user;
}

export async function login(email: string, password: string): Promise<void> {
	if (import.meta.env.APP_BUILD) {
		const { token } = await request<{ token: string }>('/api/auth/login', {
			method: 'POST',
			body: { email, password, client: 'device', label: 'Torsel sur Android' }
		});
		setDeviceToken(token);
		return;
	}

	await request<undefined>('/api/auth/login', {
		method: 'POST',
		body: { email, password, client: 'web' }
	});
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
