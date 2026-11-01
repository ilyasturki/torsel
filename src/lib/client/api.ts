export class ApiError extends Error {
	public readonly status: number;

	public readonly payload: unknown;

	public constructor(status: number, message: string, payload?: unknown) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
		this.payload = payload;
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
		throw new ApiError(OFFLINE, 'Can’t reach this server.');
	}

	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		payload = undefined;
	}

	if (typeof payload !== 'object' || payload === null || !('ok' in payload)) {
		throw new ApiError(response.status, 'This address isn’t a Torsel server.');
	}

	if (!response.ok) {
		throw new ApiError(response.status, 'This server is up but reports a problem.');
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

function sentence(text: string): string {
	const capital = text.charAt(0).toUpperCase() + text.slice(1);
	return /[.!?…]$/u.test(capital) ? capital : `${capital}.`;
}

function refusal(status: number, payload: unknown): string {
	if (status === 401) {
		return 'Your session has ended. Sign in again.';
	}
	return sentence(messageFrom(payload, `Request failed (${status})`));
}

/** A POST whose answer arrives as one JSON object per line. `EventSource` can't POST or send a bearer token. */
export async function streamLines<T>(
	path: string,
	options: { body: unknown; signal: AbortSignal },
	onLine: (line: T) => void
): Promise<void> {
	const base = apiBase();
	if (base === null) {
		throw new ApiError(NO_SERVER, 'No server connected.');
	}

	const headers = new Headers({ 'content-type': 'application/json' });
	const token = deviceToken();
	if (token !== null) {
		headers.set('authorization', `Bearer ${token}`);
	}

	let response: Response;
	try {
		response = await fetch(`${base}${path}`, {
			method: 'POST',
			headers,
			body: JSON.stringify(options.body),
			signal: options.signal
		});
	} catch (error) {
		if (options.signal.aborted) {
			throw error;
		}
		throw new ApiError(OFFLINE, 'Can’t reach this server.');
	}

	if (!response.ok || response.body === null) {
		const payload: unknown = await response.json().catch(() => undefined);
		if (response.status === 401 && token !== null) {
			setDeviceToken(null);
		}
		throw new ApiError(response.status, refusal(response.status, payload), payload);
	}

	const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
	let buffer = '';
	for (;;) {
		const { done, value } = await reader.read();
		if (done) {
			return;
		}
		buffer += value;
		const lines = buffer.split('\n');
		buffer = lines.pop() ?? '';
		for (const line of lines) {
			if (line !== '') {
				// oxlint-disable-next-line typescript/no-unsafe-type-assertion
				onLine(JSON.parse(line) as T);
			}
		}
	}
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
	const { method = 'GET', body, fetch = globalThis.fetch } = options;

	const base = apiBase();

	if (base === null) {
		throw new ApiError(NO_SERVER, 'No server connected.');
	}

	const headers = new Headers();

	// SvelteKit's built server answers 403 to a cross-origin mutation with no content type, body or not.
	if (method !== 'GET') {
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
		throw new ApiError(OFFLINE, 'Can’t reach this server.');
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

		throw new ApiError(response.status, refusal(response.status, payload), payload);
	}

	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	return payload as T;
}
