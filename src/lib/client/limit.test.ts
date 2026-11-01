import { describe, expect, it } from 'vitest';

import { limitMessage, limitOf } from './limit.ts';

const now = new Date(2026, 10, 1, 9, 30);
const later = new Date(2026, 10, 1, 21, 5).getTime();
const tomorrow = new Date(2026, 10, 2, 8, 15).getTime();
const time = (at: number): string =>
	new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

describe('a refused prompt', () => {
	it('tells the account it reached its limit, and when it can ask again today', () => {
		expect(limitMessage({ scope: 'account', until: later }, now)).toBe(
			`You’ve reached today’s assistant limit. Ask again at ${time(later)}.`
		);
	});

	it('says tomorrow when the time falls on the next day', () => {
		expect(limitMessage({ scope: 'account', until: tomorrow }, now)).toBe(
			`You’ve reached today’s assistant limit. Ask again tomorrow at ${time(tomorrow)}.`
		);
	});

	it('puts the server’s limit on the server, not on the account', () => {
		const message = limitMessage({ scope: 'instance', until: tomorrow }, now);
		expect(message).toBe(
			`The assistant has reached today’s limit on this server. Ask again tomorrow at ${time(tomorrow)}.`
		);
		expect(message).not.toMatch(/you/iu);
	});

	it('reads only a body that names a cap', () => {
		expect(limitOf({ message: 'x', scope: 'instance', until: 5 })).toEqual({
			scope: 'instance',
			until: 5
		});
		expect(limitOf({ message: 'too many requests' })).toBeNull();
		expect(limitOf(undefined)).toBeNull();
	});
});
