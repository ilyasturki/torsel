import { describe, expect, it } from 'vitest';

import { dayPicked, durationStep } from './dates.ts';

describe('a day picked on the calendar', () => {
	it('is the day for a date', () => {
		expect(dayPicked({ type: 'date' }, '2026-11-03', '2026-11-12')).toBe('2026-11-12');
	});

	it('keeps the time a date and time had', () => {
		expect(dayPicked({ type: 'datetime' }, '2026-11-03T07:30', '2026-11-12')).toBe(
			'2026-11-12T07:30'
		);
		expect(dayPicked({ type: 'datetime' }, null, '2026-11-12')).toBe('2026-11-12');
	});
});

describe('a duration stepped', () => {
	it('moves five minutes and stops at zero', () => {
		expect(durationStep(5400, 1)).toBe(5700);
		expect(durationStep(5400, -1)).toBe(5100);
		expect(durationStep(null, 1)).toBe(300);
		expect(durationStep(120, -1)).toBe(0);
	});
});
