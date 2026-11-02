import type { FieldDef, Value } from '../core/model.ts';
import { pad, parseDate, parseNumber, validDay } from '../core/values.ts';

export type NumberStyle = {
	/** Every digit, for an editor: what it seeds reads back as the same number. */
	edit?: boolean;
};

export type DateStyle = { withYear?: boolean };

const SPACES = /[\s  ]/gu;
const ISO_LIKE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/u;
const TIME = /^(.*?)[\s,]*(\d{1,2})(?:(?::|\s*h\s*|\.)(\d{2}))?\s*(?:([ap])\.?\s?m\.?)?$/iu;

function escaped(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function plain(word: string): string {
	return word
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.normalize('NFC')
		.replace(/\.$/u, '')
		.toLowerCase();
}

/** Formats and readers for one locale; `undefined` is the browser's. */
export function localeFormats(locale?: string) {
	const shown = new Intl.NumberFormat(locale, { maximumFractionDigits: 2, useGrouping: 'min2' });
	const precise = new Intl.NumberFormat(locale, {
		maximumFractionDigits: 100,
		useGrouping: 'min2'
	});
	const parts = precise.formatToParts(-12345.5);
	const group = parts.find((part) => part.type === 'group')?.value ?? ',';
	const decimal = parts.find((part) => part.type === 'decimal')?.value ?? '.';
	const minus = parts.find((part) => part.type === 'minusSign')?.value ?? '-';
	const spacedGroup = group.replace(SPACES, '') === '';
	const grouped = new RegExp(
		`^[-+]?\\d{1,3}(?:${escaped(group)}\\d{2,3})*${escaped(group)}\\d{3}(?:${escaped(decimal)}\\d+)?$`,
		'u'
	);
	const decimalOnly = new RegExp(`^[-+]?\\d*${escaped(decimal)}\\d+$`, 'u');
	const nativeDigits = new Map(
		Array.from({ length: 10 }, (_, at) => [shown.format(at), String(at)])
	);

	function latin(text: string): string {
		return text
			.replace(/\p{Cf}/gu, '')
			.replace(/\p{Nd}/gu, (digit) => nativeDigits.get(digit) ?? digit);
	}

	function formatNumber(value: number, style: NumberStyle = {}): string {
		return (style.edit ? precise : shown).format(value);
	}

	/** The locale's own form exactly, else any form `parseNumber` tolerates. */
	function readNumber(raw: string): number | null {
		const text = latin(raw.replace(SPACES, '')).replaceAll(minus, '-').replaceAll('−', '-');
		if (!spacedGroup && grouped.test(text)) {
			return parseNumber(text.replaceAll(group, '').replace(decimal, '.'));
		}
		if (decimalOnly.test(text)) {
			return parseNumber(text.replace(decimal, '.'));
		}
		return parseNumber(text);
	}

	const shortDate = (withYear: boolean) =>
		new Intl.DateTimeFormat(locale, {
			day: 'numeric',
			month: 'short',
			year: withYear ? 'numeric' : undefined
		});
	const dayMonth = shortDate(false);
	const dayMonthYear = shortDate(true);
	const numericDate = new Intl.DateTimeFormat(locale, {
		day: 'numeric',
		month: 'numeric',
		year: 'numeric'
	});
	const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' });
	const month = new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric' });
	const order = numericDate.formatToParts(new Date(2024, 0, 5)).map((part) => part.type);
	const monthFirst = order.indexOf('month') < order.indexOf('day');
	const periods = [3, 15].flatMap((hours) => {
		const word = time
			.formatToParts(new Date(2024, 0, 1, hours))
			.find((part) => part.type === 'dayPeriod')?.value;
		return word === undefined
			? []
			: [{ word: new RegExp(`(?<!\\p{L})${escaped(word)}(?!\\p{L})`, 'iu'), pm: hours > 12 }];
	});

	const monthNames: [string, number][] = [];
	for (const names of [locale, 'en']) {
		for (const width of ['short', 'long'] as const) {
			const format = new Intl.DateTimeFormat(names, { month: width });
			for (let at = 0; at < 12; at += 1) {
				monthNames.push([plain(format.format(new Date(2024, at, 1))), at + 1]);
			}
		}
	}

	function monthOf(word: string): number | undefined {
		const name = plain(word);
		const exact = monthNames.find(([candidate]) => candidate === name);
		if (exact !== undefined || name.length < 3) {
			return exact?.[1];
		}
		const months = new Set(
			monthNames.filter(([candidate]) => candidate.startsWith(name)).map(([, at]) => at)
		);
		return months.size === 1 ? [...months][0] : undefined;
	}

	function dateOf(iso: string): { date: Date; timed: boolean } | null {
		const normal = parseDate(iso);
		if (normal === null) {
			return null;
		}
		const [year, monthAt, day] = normal.slice(0, 10).split('-').map(Number);
		const [hours, minutes] = normal.length > 10 ? normal.slice(11).split(':').map(Number) : [0, 0];
		const date = new Date(year, monthAt - 1, day, hours, minutes);
		date.setFullYear(year);
		return { date, timed: normal.length > 10 };
	}

	function formatDate(iso: string, style: DateStyle = {}, now: Date = new Date()): string {
		const read = dateOf(iso);
		if (read === null) {
			return iso;
		}
		const showYear = style.withYear || read.date.getFullYear() !== now.getFullYear();
		const day = (showYear ? dayMonthYear : dayMonth).format(read.date);
		return read.timed ? `${day} ${time.format(read.date)}` : day;
	}

	function formatMonth(iso: string): string {
		const [year, monthAt] = iso.split('-').map(Number);
		return monthAt ? month.format(new Date(year, monthAt - 1, 1)) : iso;
	}

	function splitTime(raw: string): { day: string; hours: number; minutes: number } | null {
		const period = periods.find(({ word }) => word.test(raw));
		const match = TIME.exec(period === undefined ? raw : raw.replace(period.word, ' '));
		if (match === null) {
			return null;
		}
		const [, day, hourText, minuteText, meridiem] = match;
		const pm = period?.pm ?? (meridiem === undefined ? undefined : meridiem.toLowerCase() === 'p');
		if (minuteText === undefined && pm === undefined) {
			return null;
		}
		let hours = Number(hourText);
		const minutes = Number(minuteText ?? 0);
		if (pm !== undefined) {
			if (hours < 1 || hours > 12) {
				return null;
			}
			hours = (hours % 12) + (pm ? 12 : 0);
		}
		return hours > 23 || minutes > 59 ? null : { day, hours, minutes };
	}

	function readDay(text: string, now: Date): string | null {
		if (!/^[\p{L}\d\s/.,-]+$/u.test(text)) {
			return null;
		}
		const words = (text.match(/\p{L}+\.?/gu) ?? []).filter((word) => plain(word).length > 2);
		const numbers = (text.match(/\d+/gu) ?? []).map((digits) => ({
			value: Number(digits),
			long: digits.length > 2
		}));
		let year: number | undefined;
		let monthAt: number | undefined;
		let day: number | undefined;

		if (words.length === 1) {
			monthAt = monthOf(words[0]);
			if (numbers.length === 2) {
				const at = numbers[0].long ? 0 : 1;
				year = numbers[at].value;
				day = numbers[1 - at].value;
			} else if (numbers.length === 1) {
				day = numbers[0].value;
			}
		} else if (words.length === 0 && (numbers.length === 2 || numbers.length === 3)) {
			if (numbers.length === 3 && numbers[0].long) {
				[year, monthAt, day] = numbers.map((number) => number.value);
			} else {
				const [first, second, third] = numbers.map((number) => number.value);
				[monthAt, day] = monthFirst ? [first, second] : [second, first];
				year = third;
			}
		}

		if (year !== undefined && year < 100) {
			year += 2000;
		}
		year ??= now.getFullYear();
		if (monthAt === undefined || day === undefined || !validDay(year, monthAt, day)) {
			return null;
		}
		return `${year}-${pad(monthAt)}-${pad(day)}`;
	}

	/** ISO, the locale's numeric order, or its month names; a time may follow. */
	function readDate(raw: string, now: Date = new Date()): string | null {
		const text = latin(raw).trim();
		const iso = /^\d{4}-/u.test(text) ? parseDate(text) : null;
		if (iso !== null) {
			return iso;
		}
		const timed = splitTime(text);
		const day = timed === null ? null : readDay(timed.day.replace(/[\s,]+$/u, ''), now);
		if (timed === null || day === null) {
			return readDay(text, now);
		}
		return `${day}T${pad(timed.hours)}:${pad(timed.minutes)}`;
	}

	function formatValue(
		field: Pick<FieldDef, 'type'>,
		value: Value | undefined,
		now?: Date
	): string {
		if (value === null || value === undefined || value === '') {
			return '';
		}
		if (typeof value === 'number') {
			return field.type === 'check' ? (value ? 'yes' : 'no') : formatNumber(value);
		}
		if (typeof value === 'boolean') {
			return value ? 'yes' : 'no';
		}
		if (typeof value === 'string') {
			const dated =
				field.type === 'date' || (field.type === 'formula' && ISO_LIKE.test(value.trim()));
			return dated ? formatDate(value.trim(), {}, now) : value;
		}
		return JSON.stringify(value);
	}

	/** Every digit and no grouping: what a copied cell pastes as. */
	function plainNumber(value: number): string {
		return String(value).replace('.', decimal);
	}

	return {
		formatNumber,
		readNumber,
		plainNumber,
		formatDate,
		formatMonth,
		readDate,
		formatValue
	};
}

export type LocaleFormats = ReturnType<typeof localeFormats>;

export const browserFormats = localeFormats();

export const {
	formatNumber,
	readNumber,
	plainNumber,
	formatDate,
	formatMonth,
	readDate,
	formatValue
} = browserFormats;
