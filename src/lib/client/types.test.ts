import { describe, expect, it } from 'vitest';

import type { FieldFormat, Value } from '../core/model.ts';

import { localeFormats } from './format.ts';

const AMOUNTS = [0, 1, -1, 7.5, 12.5, 2024, 12345.67, -54321.5, 999999.99, 1234567.25];

const TYPED: [FieldFormat, Value[]][] = [
	[{ type: 'number', decimals: 1 }, [0, 7.5, -2.25, 12345.67, 2024]],
	[{ type: 'number', grouping: false }, [2024, 12345.5, 1234567]],
	[{ type: 'number', unit: 'kg' }, [80, 102.5, 12345]],
	[{ type: 'currency', currency: 'EUR' }, AMOUNTS],
	[{ type: 'currency', currency: 'USD' }, AMOUNTS],
	[{ type: 'currency', currency: 'JPY' }, [0, 1, 1200, -54321, 1234567]],
	[{ type: 'currency', currency: 'GBP', decimals: 0 }, [12, 2024, 12345]],
	[{ type: 'percent' }, [0, 25, 12.5, -3.25, 150, 0.125]],
	[{ type: 'percent', decimals: 0 }, [25, 100]],
	[{ type: 'rating' }, [1, 3, 5]],
	[{ type: 'rating', min: 0, max: 10, step: 0.5 }, [0, 7.5, 10]],
	[{ type: 'duration' }, [0, 60, 5400, 86400, -600, 90]],
	[{ type: 'duration', seconds: true }, [0, 59, 90, 5430, 86399]],
	[{ type: 'date' }, ['2024-01-05', '2026-12-31']],
	[{ type: 'datetime' }, ['2024-01-05T15:05', '2026-03-09T00:00', '2024-01-05']],
	[{ type: 'choice' }, ['Squat']],
	[{ type: 'choices' }, [['Drama', 'Sci-fi'], ['Drama']]],
	[{ type: 'check' }, [true, false]],
	[{ type: 'text' }, [' a note ']],
	[{ type: 'longtext' }, ['line one\nline two']],
	[{ type: 'url' }, ['https://torsel.app/a?b=1', 'example.com']],
	[{ type: 'email' }, ['ana@example.com']],
	[{ type: 'phone' }, ['+33 6 12 34 56 78']]
];

describe.each(['en-US', 'en-GB', 'fr-FR', 'de-DE', 'ja-JP'])('every type in %s', (locale) => {
	const format = localeFormats(locale);

	it.each(TYPED)('%o reads back what its editor opens on', (field, values) => {
		for (const value of values) {
			expect(format.readValue(field, format.editText(field, value)), String(value)).toEqual(value);
		}
	});

	it.each(TYPED.filter(([, values]) => typeof values[0] === 'number'))(
		'%o reads back what its input opens on beside its affixes',
		(field, values) => {
			const { prefix, suffix } = format.affixes(field);
			for (const value of values as number[]) {
				const bare = format.bareText(field, value);
				expect(format.readValue(field, bare), bare).toEqual(value);
				expect(format.readValue(field, `${prefix}${bare}${suffix}`), bare).toEqual(value);
			}
		}
	);

	it.each(TYPED)('%o reads back what a copy pastes', (field, values) => {
		for (const value of values) {
			expect(format.readValue(field, format.copyValue(field, value)), String(value)).toEqual(value);
		}
	});
});

describe('each type', () => {
	const us = localeFormats('en-US');
	const fr = localeFormats('fr-FR');

	it('shows a number with its decimals, grouping and unit', () => {
		expect(us.formatValue({ type: 'number', decimals: 2 }, 3.1)).toBe('3.10');
		expect(us.formatValue({ type: 'number', grouping: false }, 1234567)).toBe('1234567');
		expect(fr.formatValue({ type: 'number', unit: 'kg' }, 102.5)).toBe('102,5 kg');
		expect(us.readValue({ type: 'number', unit: 'kg' }, '80kg')).toBe(80);
	});

	it('shows an amount in its currency the locale way', () => {
		expect(us.formatValue({ type: 'currency', currency: 'EUR' }, 1234.5)).toBe('€1,234.50');
		expect(fr.formatValue({ type: 'currency', currency: 'EUR' }, 1234.5)).toBe('1 234,50 €');
		expect(us.formatValue({ type: 'currency', currency: 'JPY' }, 1200)).toBe('¥1,200');
		expect(fr.readValue({ type: 'currency', currency: 'EUR' }, '12')).toBe(12);
		expect(us.readValue({ type: 'currency', currency: 'USD' }, '$1,234.50')).toBe(1234.5);
		expect(us.readValue({ type: 'currency', currency: 'USD' }, 'lots')).toBeUndefined();
	});

	it('shows a percent in points', () => {
		expect(us.formatValue({ type: 'percent' }, 12.5)).toBe('12.5%');
		expect(fr.formatValue({ type: 'percent' }, 12.5)).toBe('12,5 %');
		expect(us.readValue({ type: 'percent' }, '25')).toBe(25);
	});

	it('shows a rating out of its maximum and refuses one off its scale', () => {
		expect(us.formatValue({ type: 'rating', max: 10 }, 7)).toBe('7/10');
		expect(us.readValue({ type: 'rating' }, '★★★★')).toBe(4);
		expect(us.readValue({ type: 'rating' }, '6')).toBeUndefined();
		expect(fr.readValue({ type: 'rating', max: 10, step: 0.5 }, '7,5')).toBe(7.5);
	});

	it('shows a duration on a clock, its seconds when the editor needs them', () => {
		expect(us.formatValue({ type: 'duration' }, 5400)).toBe('1:30');
		expect(us.formatValue({ type: 'duration', seconds: true }, 90)).toBe('0:01:30');
		expect(us.editText({ type: 'duration' }, 90)).toBe('0:01:30');
		expect(us.readValue({ type: 'duration' }, '1h 30')).toBe(5400);
	});

	it('names a multiple choice as the field spells it', () => {
		const field = {
			type: 'choices' as const,
			choices: [
				{ name: 'Drama', color: null },
				{ name: 'Sci-fi', color: null }
			]
		};
		expect(us.readValue(field, 'drama; sci-fi, Noir')).toEqual(['Drama', 'Sci-fi', 'Noir']);
		expect(us.formatValue(field, ['Drama', 'Sci-fi'])).toBe('Drama, Sci-fi');
	});

	it('keeps the time of a date and time, and drops it from a date', () => {
		expect(us.readValue({ type: 'date' }, '1/5/2024 3:05 PM')).toBe('2024-01-05');
		expect(us.readValue({ type: 'datetime' }, '1/5/2024 3:05 PM')).toBe('2024-01-05T15:05');
	});

	it('shows a web address without its scheme and refuses what is not one', () => {
		expect(us.formatValue({ type: 'url' }, 'https://www.torsel.app/')).toBe('torsel.app');
		expect(us.readValue({ type: 'email' }, 'not an email')).toBeUndefined();
		expect(us.readValue({ type: 'phone' }, '+1 (555) 010-2030')).toBe('+1 (555) 010-2030');
	});
});
