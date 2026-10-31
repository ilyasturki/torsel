const HOME = '/app';
const SIGN_IN = '/app/login';

const APP_PATH = /^\/app(?:[/?#]|$)/u;
const SIGN_IN_PATH = /^\/app\/login(?:[/?#]|$)/u;
const ENCODED_SEPARATOR = /%(?:2f|5c|2e)/iu;
const DOT_SEGMENT = /(?:^|\/)\.\.?(?:\/|$)/u;
// oxlint-disable-next-line no-control-regex
const UNSAFE = /[\\\s\u0000-\u001f\u007f]/u;
const PROBE = 'http://torsel.invalid';

/** The only gate between a URL parameter and a redirect: `goto`, Location headers and emailed links all take its answer. */
export function returnPath(value: unknown): string | null {
	if (typeof value !== 'string' || value.length > 2000) {
		return null;
	}
	if (!APP_PATH.test(value) || SIGN_IN_PATH.test(value) || UNSAFE.test(value)) {
		return null;
	}

	const path = value.split(/[?#]/u, 1)[0];
	if (ENCODED_SEPARATOR.test(path) || DOT_SEGMENT.test(path)) {
		return null;
	}

	const resolved = new URL(value, PROBE);
	if (resolved.origin !== PROBE) {
		return null;
	}

	return APP_PATH.test(resolved.pathname + resolved.search + resolved.hash) ? value : null;
}

export function returnTarget(value: unknown): string {
	return returnPath(value) ?? HOME;
}

export function signInPath(back: unknown): string {
	const path = returnPath(back);
	return path === null ? SIGN_IN : `${SIGN_IN}?to=${encodeURIComponent(path)}`;
}
