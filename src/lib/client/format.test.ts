import { describe, expect, it } from 'vitest';

import { localeFormats } from './format.ts';

const LOCALES = [
	'en-US',
	'en-GB',
	'en-IN',
	'fr-FR',
	'fr-CA',
	'de-DE',
	'nl-NL',
	'es-ES',
	'it-IT',
	'sv-SE',
	'ja-JP',
	'ko-KR',
	'zh-TW',
	'ar-EG'
];

const NUMBERS = [
	0, 1, -1, 7.5, -0.25, 0.1, 0.30000000000000004, 3.14159, 999, 1000, 2024, -2024, 1999.5, 9999,
	10000, 12345, 12345.67, -54321.5, 100000, 999999, 123456.789, 1000000, 1234567.25, 999999999,
	-123456789, 123456789.123456
];

const NOW = new Date(2026, 10, 2);

const DATES = [
	'2026-01-05',
	'2026-12-31',
	'2024-01-05',
	'2024-02-29',
	'1999-12-31',
	'2030-07-04',
	'2024-01-05T15:05',
	'2024-11-12T00:05',
	'2026-03-09T12:00',
	'2026-03-09T23:59',
	'2001-10-03T09:30'
];

describe.each(LOCALES)('%s', (locale) => {
	const format = localeFormats(locale);

	it('reads back every number an editor opens on', () => {
		for (const value of NUMBERS) {
			expect(format.readNumber(format.formatNumber(value, { edit: true })), String(value)).toBe(
				value
			);
		}
	});

	it('reads back the shown number at its two decimals', () => {
		for (const value of NUMBERS) {
			expect(format.readNumber(format.formatNumber(value)), String(value)).toBe(
				Number(value.toFixed(2))
			);
		}
	});

	it('reads back every date it shows', () => {
		for (const iso of DATES) {
			const shown = format.formatDate(iso, {}, NOW);
			expect(format.readDate(shown, NOW), shown).toBe(iso);
		}
	});

	it('still reads ISO', () => {
		expect(format.readDate('2024-01-05', NOW)).toBe('2024-01-05');
		expect(format.readDate('2024-01-05T15:05', NOW)).toBe('2024-01-05T15:05');
	});

	it('shows a four-digit integer whole', () => {
		expect(format.formatNumber(2024)).toHaveLength(4);
	});
});

describe('the locale', () => {
	it('groups from five digits', () => {
		expect(localeFormats('en-US').formatNumber(12345.678)).toBe('12,345.68');
		expect(localeFormats('fr-FR').formatNumber(12345.678)).toBe('12 345,68');
		expect(localeFormats('de-DE').formatNumber(1234567)).toBe('1.234.567');
	});

	it('reads one group as thousands where the locale groups with it', () => {
		expect(localeFormats('en-US').readNumber('2,024')).toBe(2024);
		expect(localeFormats('en-US').readNumber('12,345')).toBe(12345);
		expect(localeFormats('de-DE').readNumber('2.024')).toBe(2024);
		expect(localeFormats('fr-FR').readNumber('2 024')).toBe(2024);
	});

	it('stays tolerant of the other decimal mark', () => {
		expect(localeFormats('fr-FR').readNumber('102.5')).toBe(102.5);
		expect(localeFormats('en-US').readNumber('102,5')).toBe(102.5);
		expect(localeFormats('de-DE').readNumber('1,234.5')).toBe(1234.5);
		expect(localeFormats('en-US').readNumber('1.234,5')).toBe(1234.5);
		expect(localeFormats('en-US').readNumber('abc')).toBeNull();
	});

	it('orders days the way the locale writes them', () => {
		expect(localeFormats('en-US').readDate('3/4/2025', NOW)).toBe('2025-03-04');
		expect(localeFormats('en-GB').readDate('3/4/2025', NOW)).toBe('2025-04-03');
		expect(localeFormats('fr-FR').readDate('03/04/2025', NOW)).toBe('2025-04-03');
		expect(localeFormats('de-DE').readDate('3.4.2025', NOW)).toBe('2025-04-03');
		expect(localeFormats('en-US').readDate('13/4/2025', NOW)).toBeNull();
	});

	it('takes the current year when none is typed', () => {
		expect(localeFormats('en-US').readDate('3/4', NOW)).toBe('2026-03-04');
		expect(localeFormats('fr-FR').readDate('3/4', NOW)).toBe('2026-04-03');
		expect(localeFormats('de-DE').readDate('1.12', NOW)).toBe('2026-12-01');
		expect(localeFormats('en-US').readDate('Jan 5', NOW)).toBe('2026-01-05');
	});

	it('reads a time in either clock', () => {
		const us = localeFormats('en-US');
		expect(us.readDate('1/5/2024 3:05 PM', NOW)).toBe('2024-01-05T15:05');
		expect(us.readDate('1/5/2024 12:05 am', NOW)).toBe('2024-01-05T00:05');
		expect(us.readDate('1/5/2024 15:05', NOW)).toBe('2024-01-05T15:05');
		expect(localeFormats('fr-FR').readDate('5 janv. 2024 15h05', NOW)).toBe('2024-01-05T15:05');
		expect(us.readDate('1/5/2024 25:00', NOW)).toBeNull();
	});

	it('shows the time in the locale form', () => {
		expect(localeFormats('en-US').formatDate('2024-01-05T15:05', {}, NOW)).toBe(
			'Jan 5, 2024 3:05 PM'
		);
		expect(localeFormats('fr-FR').formatDate('2024-01-05T15:05', {}, NOW)).toBe(
			'5 janv. 2024 15:05'
		);
	});

	it('shows a formula that returns a date as a date', () => {
		const us = localeFormats('en-US');
		expect(us.formatValue({ type: 'formula' }, '2024-01-05', NOW)).toBe('Jan 5, 2024');
		expect(us.formatValue({ type: 'formula' }, '2024-01-05 15:05:00', NOW)).toBe(
			'Jan 5, 2024 3:05 PM'
		);
		expect(us.formatValue({ type: 'formula' }, 'Squat', NOW)).toBe('Squat');
	});
});
