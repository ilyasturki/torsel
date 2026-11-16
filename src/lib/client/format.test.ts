import { afterEach, describe, expect, it } from 'vitest';

import { createBase, createTable } from '../core/actions.ts';
import { Hlc } from '../core/clock.ts';
import { DATE_STYLES } from '../core/model.ts';
import type { Change } from '../core/model.ts';
import { Workspace } from '../core/workspace.ts';
import { readServerLocale, readServerTags } from '../i18n/runtime.ts';
import {
	currencyFor,
	currencyName,
	formatDate,
	formatNumber,
	formatValue,
	localCurrency,
	localeFormats,
	timeFrom
} from './format.ts';

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

	it('reads back every date an editor opens on, in every look', () => {
		for (const look of DATE_STYLES) {
			for (const iso of DATES) {
				const field = { type: iso.length > 10 ? 'datetime' : 'date', dateStyle: look } as const;
				const shown = format.editText(field, iso);
				expect(format.readDate(shown, NOW), `${look}: ${shown}`).toBe(iso);
			}
		}
	});

	it('reads back every date it shows in the looks it can type', () => {
		const typed = locale.startsWith('en') || locale.startsWith('fr') ? DATE_STYLES : ['short'];
		for (const look of DATE_STYLES.filter((style) => typed.includes(style))) {
			for (const iso of DATES) {
				const shown = format.formatDate(iso, { look }, NOW);
				expect(format.readDate(shown, NOW), `${look}: ${shown}`).toBe(iso);
			}
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

	it('shows a date in the look its field picks', () => {
		const fr = localeFormats('fr-FR');
		const look = (dateStyle: (typeof DATE_STYLES)[number]) =>
			fr.formatValue({ type: 'date', dateStyle }, '2026-12-28', NOW);
		expect(look('short')).toBe('28 déc.');
		expect(look('numeric')).toBe('28/12/2026');
		expect(look('weekday')).toBe('lun. 28 déc.');
		expect(look('long')).toBe('28 décembre 2026');
		expect(look('iso')).toBe('2026-12-28');
		expect(fr.formatValue({ type: 'datetime', dateStyle: 'iso' }, '2026-12-28T07:05', NOW)).toBe(
			'2026-12-28 07:05'
		);
		expect(
			localeFormats('en-US').formatValue({ type: 'date', dateStyle: 'weekday' }, '2026-12-28', NOW)
		).toBe('Mon, Dec 28');
	});

	it('shows a formula result in the type it picks', () => {
		const fr = localeFormats('fr-FR');
		expect(fr.formatValue({ type: 'formula' }, 12345.678)).toBe('12 345,68');
		expect(fr.formatValue({ type: 'formula', result: 'number', decimals: 1 }, 12345.678)).toBe(
			'12 345,7'
		);
		expect(fr.formatValue({ type: 'formula', result: 'currency', currency: 'EUR' }, 12.5)).toBe(
			'12,50 €'
		);
		expect(fr.formatValue({ type: 'formula', result: 'percent', decimals: 0 }, 42.4)).toBe('42 %');
		expect(
			fr.formatValue({ type: 'formula', result: 'date', dateStyle: 'long' }, '2026-12-28', NOW)
		).toBe('28 décembre 2026');
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

describe('the words for a day', () => {
	it('reads today, tomorrow and yesterday in English and French', () => {
		for (const locale of ['en-US', 'fr-FR']) {
			const format = localeFormats(locale);
			expect(format.readDate('today', NOW)).toBe('2026-11-02');
			expect(format.readDate('Tomorrow', NOW)).toBe('2026-11-03');
			expect(format.readDate('yesterday', NOW)).toBe('2026-11-01');
			expect(format.readDate("aujourd'hui", NOW)).toBe('2026-11-02');
			expect(format.readDate('aujourd’hui', NOW)).toBe('2026-11-02');
			expect(format.readDate('Demain', NOW)).toBe('2026-11-03');
			expect(format.readDate('hier', NOW)).toBe('2026-11-01');
		}
	});

	it('takes a time after the word', () => {
		expect(localeFormats('fr-FR').readDate('demain 8:15', NOW)).toBe('2026-11-03T08:15');
		expect(localeFormats('en-US').readDate('today 3:05 pm', NOW)).toBe('2026-11-02T15:05');
	});

	it('refuses a word that only the object prototype knows', () => {
		expect(localeFormats('en-US').readDate('constructor', NOW)).toBeNull();
	});

	it('crosses the end of a month', () => {
		expect(localeFormats('en-US').readDate('tomorrow', new Date(2026, 11, 31))).toBe('2027-01-01');
	});
});

describe('a currency typed in another one', () => {
	const eur = { type: 'currency' as const, currency: 'EUR' };

	it('reads the field own sign, code or none as an amount', () => {
		for (const locale of ['en-US', 'fr-FR']) {
			const format = localeFormats(locale);
			for (const text of ['12', '€12', '12 €', '12 EUR']) {
				expect(format.otherCurrency(text, 'EUR'), `${locale} ${text}`).toBe(false);
			}
		}
		expect(localeFormats('fr-FR').readValue(eur, '12,50 €')).toBe(12.5);
	});

	it('tells another currency apart', () => {
		const us = localeFormats('en-US');
		expect(us.otherCurrency('$12', 'EUR')).toBe(true);
		expect(us.otherCurrency('12 USD', 'EUR')).toBe(true);
		expect(us.otherCurrency('£3', 'EUR')).toBe(true);
	});

	it('takes a narrow sign as the field own', () => {
		expect(localeFormats('fr-FR').otherCurrency('$12', 'CAD')).toBe(false);
		expect(localeFormats('en-US').otherCurrency('$12', 'USD')).toBe(false);
	});

	it('names the currency as an amount of it reads', () => {
		expect(localeFormats('en-US').currencyName('EUR')).toBe('euros');
		expect(localeFormats('fr-FR').currencyName('EUR')).toBe('euros');
		expect(localeFormats('fr-FR').currencyName('USD')).toBe('dollars des États-Unis');
	});
});

describe('a new currency field', () => {
	const hlc = new Hlc('test');
	const commit = (ws: Workspace, changes: Change[]): void => {
		for (const change of changes) ws.stamp(change, hlc.tick());
	};
	const table = (ws: Workspace, base: string, currencies: string[]): string => {
		const made = createTable(
			ws,
			base,
			'Spend',
			[
				{ name: 'Item', type: 'text' },
				...currencies.map((currency, at) => ({
					name: `Price ${at}`,
					type: 'currency' as const,
					currency
				}))
			],
			() => []
		);
		commit(ws, made.changes);
		return made.id;
	};

	it('takes what the table uses most, then the workspace, then the locale', () => {
		const ws = new Workspace();
		const base = createBase(ws, 'Money');
		commit(ws, base.changes);
		const gbp = table(ws, base.id, ['GBP', 'GBP', 'EUR']);
		const bare = table(ws, base.id, []);
		expect(currencyFor(ws, gbp, 'en-US')).toBe('GBP');
		expect(currencyFor(ws, bare, 'en-US')).toBe('GBP');
		expect(currencyFor(new Workspace(), bare, 'en-US')).toBe('USD');
		expect(currencyFor(new Workspace(), bare, 'fr-FR')).toBe('EUR');
	});
});

describe('timeFrom', () => {
	it('says how long ago or how soon, in the locale', () => {
		const now = Date.UTC(2026, 10, 16, 12);
		expect(timeFrom(now - 12 * 60_000, now, 'en-US')).toBe('12 min. ago');
		expect(timeFrom(now + 48 * 60_000, now, 'en-US')).toBe('in 48 min.');
		expect(timeFrom(now - 2 * 3_600_000, now, 'fr-FR')).toMatch(/^il y a\s2\sh$/u);
		expect(timeFrom(now, now, 'en-US')).toBe('now');
	});
});

describe('the formats of the words’ language', () => {
	afterEach(() => {
		readServerLocale(() => undefined);
		readServerTags(() => undefined);
	});

	it('follow French words in the system’s French locale, whatever Intl’s default', () => {
		readServerLocale(() => 'fr');
		readServerTags(() => ['fr-FR', 'fr', 'en-US', 'en']);
		expect(formatNumber(90.7)).toBe('90,7');
		expect(formatDate('2026-10-24', {}, NOW)).toBe('24 oct.');
		expect(formatValue({ type: 'currency', currency: 'EUR' }, 10)).toBe('10,00\u00a0€');
		expect(localCurrency()).toBe('EUR');
		expect(currencyName('USD')).toBe('dollars des États-Unis');
	});

	it('take the region the system names for that language', () => {
		readServerLocale(() => 'en');
		readServerTags(() => ['en-GB']);
		expect(formatDate('2026-10-24', {}, NOW)).toBe('24 Oct');
		expect(localCurrency()).toBe('GBP');
	});
});
