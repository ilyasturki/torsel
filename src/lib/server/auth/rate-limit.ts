import { error } from '@sveltejs/kit';
import { errors } from '../../i18n/errors.ts';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

const MAX_TRACKED = 10_000;

export type Window = {
	hit: (key: string) => boolean;
	/** Milliseconds until `key` may hit again, 0 when it may now. */
	wait: (key: string) => number;
	reset: () => void;
};

// In memory: an instance is one process on one SQLite file.
export function slidingWindow(limit: number, windowMs: number): Window {
	const hits = new Map<string, number[]>();

	return {
		hit(key) {
			const now = Date.now();
			const recent = (hits.get(key) ?? []).filter((at) => now - at < windowMs).slice(-limit);
			recent.push(now);

			hits.delete(key);
			while (hits.size >= MAX_TRACKED) {
				const oldest = hits.keys().next().value;
				if (oldest === undefined) {
					break;
				}
				hits.delete(oldest);
			}
			hits.set(key, recent);

			return recent.length > limit;
		},
		wait(key) {
			const recent = hits.get(key) ?? [];
			if (recent.length < limit) {
				return 0;
			}
			return Math.max(0, recent[recent.length - limit] + windowMs - Date.now());
		},
		reset() {
			hits.clear();
		}
	};
}

/** Seconds `key` must wait, or null when it may go now; `limit` is read per call, 0 for no cap. */
export function perMinute(limit: () => number): (key: string) => number | null {
	const windows = new Map<number, Window>();
	return (key) => {
		const max = limit();
		if (max === 0) {
			return null;
		}
		let window = windows.get(max);
		if (window === undefined) {
			window = slidingWindow(max, MINUTE);
			windows.set(max, window);
		}
		return window.hit(key) ? Math.max(1, Math.ceil(window.wait(key) / 1000)) : null;
	};
}

// By address alone: every sign-in starts here, so a window per email would let anyone lock its owner out.
const lookups = slidingWindow(30, 15 * MINUTE);

export function enforceLookup(address: string): void {
	if (lookups.hit(address)) {
		error(429, errors.tooMany);
	}
}

export const LIMITS = {
	signUp: { ip: slidingWindow(10, HOUR), email: slidingWindow(3, HOUR) },
	link: { ip: slidingWindow(10, HOUR), email: slidingWindow(3, HOUR) },
	code: { ip: slidingWindow(30, 15 * MINUTE), email: slidingWindow(30, 15 * MINUTE) }
};

// Per address: a link is opened by anyone, and each image of it is one more request.
export const PUBLISHED = { page: slidingWindow(60, MINUTE), files: slidingWindow(600, MINUTE) };

export function enforcePublished(window: Window, address: string): void {
	if (window.hit(address)) {
		error(429, errors.tooMany);
	}
}

/** Charges both windows even when the first refuses: a flood must not spare the other. */
export function enforce(
	limit: { ip: Window; email: Window },
	address: string,
	email: string
): void {
	const byIp = limit.ip.hit(address);
	const byEmail = limit.email.hit(email);

	if (byIp || byEmail) {
		error(429, errors.tooMany);
	}
}

export function resetRateLimits(): void {
	lookups.reset();
	PUBLISHED.page.reset();
	PUBLISHED.files.reset();
	for (const limit of Object.values(LIMITS)) {
		limit.ip.reset();
		limit.email.reset();
	}
}
