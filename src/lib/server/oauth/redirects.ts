const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

const MAX_URI = 2000;

function parse(uri: string): URL | null {
	if (uri.length > MAX_URI || uri.includes('#')) {
		return null;
	}
	try {
		return new URL(uri);
	} catch {
		return null;
	}
}

export function isLoopback(uri: string): boolean {
	const url = parse(uri);
	return url !== null && url.protocol === 'http:' && LOOPBACK.has(url.hostname);
}

/** Where a client may ask to be sent back: https anywhere, or plain http on this device. */
export function validRedirect(uri: string): boolean {
	const url = parse(uri);
	if (url === null || url.username !== '' || url.password !== '') {
		return false;
	}
	return url.protocol === 'https:' || isLoopback(uri);
}

/** Exact match, except that a loopback URI may come back on any port (RFC 8252 §7.3). */
export function redirectMatches(registered: string[], requested: string): boolean {
	if (!validRedirect(requested)) {
		return false;
	}
	if (registered.includes(requested)) {
		return true;
	}
	if (!isLoopback(requested)) {
		return false;
	}
	const portless = (uri: string): string => {
		const url = new URL(uri);
		url.port = '';
		return url.href;
	};
	return registered.some((uri) => isLoopback(uri) && portless(uri) === portless(requested));
}
