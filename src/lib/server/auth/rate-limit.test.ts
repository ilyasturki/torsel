import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LIMITS, enforce, enforceLookup, resetRateLimits, slidingWindow } from './rate-limit.ts';

beforeEach(() => {
	vi.useFakeTimers();
	resetRateLimits();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('slidingWindow', () => {
	it('refuses past the limit and forgets once the window has moved', () => {
		const window = slidingWindow(2, 1000);

		expect(window.hit('a')).toBe(false);
		expect(window.hit('a')).toBe(false);
		expect(window.hit('a')).toBe(true);
		expect(window.hit('b')).toBe(false);

		vi.advanceTimersByTime(1001);
		expect(window.hit('a')).toBe(false);
	});

	it('forgets the oldest key rather than grow without bound', () => {
		const window = slidingWindow(1, 60_000);

		window.hit('first');
		for (let key = 0; key < 10_000; key += 1) {
			window.hit(String(key));
		}

		expect(window.hit('first')).toBe(false);
	});
});

describe('enforce', () => {
	it('answers 429 per address and per email', () => {
		for (let sent = 0; sent < 3; sent += 1) {
			enforce(LIMITS.link, `10.0.0.${sent}`, 'me@example.com');
		}
		expect(() => enforce(LIMITS.link, '10.0.1.1', 'me@example.com')).toThrow(
			expect.objectContaining({ status: 429 })
		);

		for (let sent = 0; sent < 10; sent += 1) {
			enforce(LIMITS.link, '10.0.2.1', `${sent}@example.com`);
		}
		expect(() => enforce(LIMITS.link, '10.0.2.1', 'other@example.com')).toThrow(
			expect.objectContaining({ status: 429 })
		);
	});

	it('charges the address even when the email is already refused', () => {
		for (let sent = 0; sent < 3; sent += 1) {
			enforce(LIMITS.link, '10.0.3.1', 'flood@example.com');
		}
		for (let sent = 0; sent < 7; sent += 1) {
			expect(() => enforce(LIMITS.link, '10.0.3.1', 'flood@example.com')).toThrow();
		}
		expect(() => enforce(LIMITS.link, '10.0.3.1', 'calm@example.com')).toThrow();
	});
});

describe('enforceLookup', () => {
	it('refuses per address, leaving every other address free', () => {
		for (let sent = 0; sent < 30; sent += 1) {
			enforceLookup('10.0.4.1');
		}

		expect(() => enforceLookup('10.0.4.1')).toThrow(expect.objectContaining({ status: 429 }));
		expect(() => enforceLookup('10.0.4.2')).not.toThrow();
	});
});
