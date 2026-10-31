import { error } from '@sveltejs/kit';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

const MAX_TRACKED = 10_000;

export type Window = { hit: (key: string) => boolean; reset: () => void };

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
		reset() {
			hits.clear();
		}
	};
}

const TOO_MANY = 'Too many tries. Wait a moment and try again.';

// By address alone: every sign-in starts here, so a window per email would let anyone lock its owner out.
const lookups = slidingWindow(30, 15 * MINUTE);

export function enforceLookup(address: string): void {
	if (lookups.hit(address)) {
		error(429, TOO_MANY);
	}
}

export const LIMITS = {
	signUp: { ip: slidingWindow(10, HOUR), email: slidingWindow(3, HOUR) },
	link: { ip: slidingWindow(10, HOUR), email: slidingWindow(3, HOUR) },
	code: { ip: slidingWindow(30, 15 * MINUTE), email: slidingWindow(30, 15 * MINUTE) }
};

/** Charges both windows even when the first refuses: a flood must not spare the other. */
export function enforce(
	limit: { ip: Window; email: Window },
	address: string,
	email: string
): void {
	const byIp = limit.ip.hit(address);
	const byEmail = limit.email.hit(email);

	if (byIp || byEmail) {
		error(429, TOO_MANY);
	}
}

export function resetRateLimits(): void {
	lookups.reset();
	for (const limit of Object.values(LIMITS)) {
		limit.ip.reset();
		limit.email.reset();
	}
}
