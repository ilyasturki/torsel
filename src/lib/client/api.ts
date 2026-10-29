export class ApiError extends Error {
	public readonly status: number;

	public constructor(status: number, message: string) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
	}
}

export const OFFLINE = 0;

export const NO_SERVER = -1;

let configured: string | null = null;

let credential: string | null = null;

// localStorage, not the IndexedDB store: these must be readable synchronously,
// before the boot's first request.
const SERVER_KEY = 'torsel.server';

const TOKEN_KEY = 'torsel.token';

// A default for the Server form only, never a fallback for `apiBase`.
export const DEFAULT_SERVER = import.meta.env.DEFAULT_SERVER;

let restored = false;

// Deferred to call time: the server build imports this module, and Node has no `localStorage`.
function restore(): void {
	if (import.meta.env.APP_BUILD && !restored) {
		restored = true;
		configured = localStorage.getItem(SERVER_KEY);
		credential = localStorage.getItem(TOKEN_KEY);
	}
}

function persist(key: string, value: string | null): void {
	restored = true;

	if (!import.meta.env.APP_BUILD) {
		return;
	}

	if (value === null) {
		localStorage.removeItem(key);
	} else {
		localStorage.setItem(key, value);
	}
}

export function apiBase(): string | null {
	restore();

	if (configured !== null) {
		return configured;
	}

	return import.meta.env.APP_BUILD ? null : location.origin;
}

export function setApiBase(base: string | null): void {
	configured = base;
	persist(SERVER_KEY, base);
}

export function deviceToken(): string | null {
	restore();

	return credential;
}

export function setDeviceToken(token: string | null): void {
	credential = token;
	persist(TOKEN_KEY, token);
}

export async function checkServer(base: string): Promise<void> {
	let response: Response;
	try {
		response = await fetch(new URL('/api/health', base));
	} catch {
		throw new ApiError(OFFLINE, 'serveur injoignable');
	}

	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		payload = undefined;
	}

	if (typeof payload !== 'object' || payload === null || !('ok' in payload)) {
		throw new ApiError(response.status, 'cette adresse n’est pas un serveur Torsel');
	}

	if (!response.ok) {
		throw new ApiError(response.status, 'le serveur répond mais se dit en panne');
	}
}

export type RequestOptions = {
	method?: string;
	body?: unknown;
	fetch?: typeof globalThis.fetch;
};

function messageFrom(payload: unknown, fallback: string): string {
	if (typeof payload === 'object' && payload !== null && 'message' in payload) {
		const { message } = payload;
		if (typeof message === 'string' && message !== '') {
			return message;
		}
	}

	return fallback;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
	const { method = 'GET', body, fetch = globalThis.fetch } = options;

	const base = apiBase();

	if (base === null) {
		throw new ApiError(NO_SERVER, 'aucun serveur connecté');
	}

	const headers = new Headers();

	if (body !== undefined) {
		headers.set('content-type', 'application/json');
	}

	const token = deviceToken();
	if (token !== null) {
		headers.set('authorization', `Bearer ${token}`);
	}

	let response: Response;
	try {
		response = await fetch(`${base}${path}`, {
			method,
			headers,
			body: body === undefined ? undefined : JSON.stringify(body)
		});
	} catch {
		throw new ApiError(OFFLINE, 'serveur injoignable');
	}

	let payload: unknown;

	if (response.status !== 204) {
		try {
			payload = await response.json();
		} catch {
			payload = undefined;
		}
	}

	if (!response.ok) {
		if (response.status === 401 && token !== null) {
			setDeviceToken(null);
		}

		throw new ApiError(
			response.status,
			messageFrom(payload, `request failed (${response.status})`)
		);
	}

	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	return payload as T;
}
