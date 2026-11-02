import type { FieldDef, Value } from '../core/model.ts';
import { parseDate, parseNumber } from '../core/values.ts';

export type NumberStyle = {
	/** Every digit, for an editor: what it seeds reads back as the same number. */
	edit?: boolean;
};

export type DateStyle = { withYear?: boolean };

const SPACES = /[\s  ]/gu;
const ISO_LIKE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/u;

function escaped(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function plain(word: string): string {
	return word.normalize('NFD').replace(/\p{M}/gu, '').replace(/\.$/u, '').toLowerCase();
}

function pad(value: number): string {
	return String(value).padStart(2, '0');
}

function validDay(year: number, month: number, day: number): boolean {
	const date = new Date(Date.UTC(year, month - 1, day));
	return (
		date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
	);
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
		`^[-+]?\\d{1,3}(?:${escaped(group)}\\d{3})+(?:${escaped(decimal)}\\d+)?$`,
		'u'
	);
	const decimalOnly = new RegExp(`^[-+]?\\d*${escaped(decimal)}\\d+$`, 'u');

	function formatNumber(value: number, style: NumberStyle = {}): string {
		return (style.edit ? precise : shown).format(value);
	}

	/** The locale's own form exactly, else any form `parseNumber` tolerates. */
	function readNumber(raw: string): number | null {
		const text = raw.replace(SPACES, '').replaceAll(minus, '-').replaceAll('−', '-');
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
	const monthFirst =
		numericDate.formatToParts(new Date(2024, 0, 5)).findIndex((part) => part.type === 'month') <
		numericDate.formatToParts(new Date(2024, 0, 5)).findIndex((part) => part.type === 'day');

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

	/** The form a date editor opens on: numeric, with the year, in the locale's order. */
	function editDate(iso: string): string {
		const read = dateOf(iso);
		if (read === null) {
			return iso;
		}
		const day = numericDate.format(read.date);
		return read.timed ? `${day} ${time.format(read.date)}` : day;
	}

	function formatMonth(iso: string): string {
		const [year, monthAt] = iso.split('-').map(Number);
		return monthAt ? month.format(new Date(year, monthAt - 1, 1)) : iso;
	}

	const TIME = /^(.*?)[\s,]*(\d{1,2})(?:(?::|h|\.)(\d{2}))?\s*(?:([ap])\.?\s?m\.?)?$/iu;

	function splitTime(text: string): { day: string; hours: number; minutes: number } | null {
		const match = TIME.exec(text);
		if (match === null) {
			return null;
		}
		const [, day, hourText, minuteText, meridiem] = match;
		if (minuteText === undefined && meridiem === undefined) {
			return null;
		}
		let hours = Number(hourText);
		const minutes = Number(minuteText ?? 0);
		if (meridiem !== undefined) {
			if (hours < 1 || hours > 12) {
				return null;
			}
			hours = (hours % 12) + (meridiem.toLowerCase() === 'p' ? 12 : 0);
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
		const text = raw.trim();
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
		editDate,
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
	editDate,
	formatMonth,
	readDate,
	formatValue
} = browserFormats;
