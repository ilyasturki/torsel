import type { Choice, FieldFormat, Value } from '../core/model.ts';
import { isDated } from '../core/model.ts';
import {
	CHOICES_JOIN,
	coerce,
	currencyOf,
	durationUnit,
	formatDuration,
	onScale,
	pad,
	parseAmount,
	parseCheck,
	parseDate,
	parseDuration,
	parseNumber,
	parseRating,
	ratingScale,
	splitChoices,
	validDay,
	withoutUnit
} from '../core/values.ts';

export type NumberStyle = {
	/** Every digit, for an editor: what it seeds reads back as the same number. */
	edit?: boolean;
	/** Exactly this many decimals shown; up to two when left out. */
	decimals?: number | null;
	grouping?: boolean;
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

	const numberFormats = new Map<string, Intl.NumberFormat>();

	function numberFormat(options: Intl.NumberFormatOptions): Intl.NumberFormat {
		const key = JSON.stringify(options);
		let format = numberFormats.get(key);
		if (format === undefined) {
			format = new Intl.NumberFormat(locale, options);
			numberFormats.set(key, format);
		}
		return format;
	}

	function formatNumber(value: number, style: NumberStyle = {}): string {
		const { edit = false, decimals = null, grouping = true } = style;
		if (decimals === null && grouping) {
			return (edit ? precise : shown).format(value);
		}
		return numberFormat({
			minimumFractionDigits: decimals ?? 0,
			maximumFractionDigits: edit ? 100 : (decimals ?? 2),
			useGrouping: grouping ? 'min2' : false
		}).format(value);
	}

	function currencyFormat(code: string, edit: boolean, decimals: number | null) {
		const fixed = numberFormat({ style: 'currency', currency: code });
		const digits = decimals ?? fixed.resolvedOptions().maximumFractionDigits ?? 2;
		return numberFormat({
			style: 'currency',
			currency: code,
			minimumFractionDigits: digits,
			maximumFractionDigits: edit ? 100 : digits
		});
	}

	function formatCurrency(value: number, field: FieldFormat, edit = false): string {
		return currencyFormat(currencyOf(field), edit, field.decimals ?? null).format(value);
	}

	/** The amount with or without its symbol or code; a bare number counts in the field's currency. */
	function readAmount(raw: string, code: string): number | null {
		const symbols = currencyFormat(code, false, null)
			.formatToParts(1)
			.filter((part) => part.type === 'currency')
			.map((part) => part.value);
		let text = raw;
		for (const symbol of [...symbols, code]) {
			text = text.replaceAll(symbol, '');
		}
		const value = readNumber(text.replace(/\p{Sc}/gu, '').trim());
		return value ?? parseAmount(raw);
	}

	const percentSign = numberFormat({ style: 'percent' })
		.formatToParts(0.25)
		.map((part) => (part.type === 'integer' ? '{n}' : part.value))
		.join('');

	function formatPercent(points: number, field: FieldFormat, edit = false): string {
		const number = formatNumber(points, { edit, decimals: field.decimals ?? null });
		return percentSign.replace('{n}', number);
	}

	function readRating(raw: string): number | null {
		const over = /^(.+?)\s*\/\s*\d+(?:[.,]\d+)?$/u.exec(raw.trim());
		return (over === null ? null : readNumber(over[1])) ?? readNumber(raw) ?? parseRating(raw);
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

	/** How a number-held value reads; `edit` gives every digit, as its editor opens on it. */
	function formatAmount(field: FieldFormat, value: number, edit = false): string {
		switch (field.type) {
			case 'currency':
				return formatCurrency(value, field, edit);
			case 'percent':
				return formatPercent(value, field, edit);
			case 'duration':
				return formatDuration(value, field.seconds === true || (edit && value % 60 !== 0));
			case 'rating': {
				const shown = formatNumber(value, { edit });
				return edit ? shown : `${shown}/${formatNumber(ratingScale(field).max)}`;
			}
			case 'check':
				return value ? 'yes' : 'no';
			case 'number': {
				const shown = formatNumber(value, {
					edit,
					decimals: field.decimals ?? null,
					grouping: field.grouping !== false
				});
				return field.unit ? `${shown} ${field.unit}` : shown;
			}
			default:
				return formatNumber(value, { edit });
		}
	}

	function formatValue(field: FieldFormat, value: Value | undefined, now?: Date): string {
		if (value === null || value === undefined || value === '') {
			return '';
		}
		if (typeof value === 'number') {
			return formatAmount(field, value);
		}
		if (typeof value === 'boolean') {
			return value ? 'yes' : 'no';
		}
		if (Array.isArray(value)) {
			return value.filter((item) => typeof item === 'string').join(CHOICES_JOIN);
		}
		if (typeof value === 'string') {
			const dated =
				isDated(field.type) || (field.type === 'formula' && ISO_LIKE.test(value.trim()));
			if (field.type === 'url') {
				return value.replace(/^https?:\/\/(?:www\.)?/iu, '').replace(/\/$/u, '');
			}
			return dated ? formatDate(value.trim(), {}, now) : value;
		}
		return JSON.stringify(value);
	}

	/** What an editor opens on: the shown form with every digit, read back by `readValue`. */
	function editText(field: FieldFormat, value: Value | undefined): string {
		if (typeof value === 'number') {
			return formatAmount(field, value, true);
		}
		if (typeof value === 'string' && isDated(field.type)) {
			return formatDate(value);
		}
		if (Array.isArray(value) || typeof value === 'boolean') {
			return formatValue(field, value);
		}
		return typeof value === 'string' ? value : '';
	}

	/**
	 * Typed or pasted text as a value of this field: null when blank, undefined when it is not one.
	 * A link needs the workspace to find its row, so it is never read here.
	 */
	function readValue(field: FieldFormat & { choices?: Choice[] }, raw: string): Value | undefined {
		const text = raw.trim();
		if (field.type === 'formula' || field.type === 'link') {
			return undefined;
		}
		if (text === '') {
			return null;
		}
		const named = (name: string): string =>
			field.choices?.find((choice) => choice.name.toLowerCase() === name.toLowerCase())?.name ??
			name;
		switch (field.type) {
			case 'number':
				return readNumber(withoutUnit(text, field.unit)) ?? undefined;
			case 'currency':
				return readAmount(text, currencyOf(field)) ?? undefined;
			case 'percent':
				return readNumber(text.replace(/[%٪]/gu, '').trim()) ?? undefined;
			case 'rating': {
				const value = readRating(text);
				return value !== null && onScale(value, ratingScale(field)) ? value : undefined;
			}
			case 'duration':
				return parseDuration(latin(text), durationUnit(field)) ?? undefined;
			case 'date':
				return readDate(text)?.slice(0, 10) ?? undefined;
			case 'datetime':
				return readDate(text) ?? undefined;
			case 'check':
				return parseCheck(text) ?? undefined;
			case 'choice':
				return named(text);
			case 'choices':
				return [...new Set(splitChoices(text).map(named))];
			case 'text':
			case 'longtext':
				return raw;
			case 'url':
			case 'email':
			case 'phone':
				return coerce(field, text) ?? undefined;
		}
	}

	/** The marks around an amount that a field draws beside its input: a symbol, a sign or a unit. */
	function affixes(field: FieldFormat): { prefix: string; suffix: string } {
		if (field.type === 'currency') {
			const parts = currencyFormat(currencyOf(field), false, null).formatToParts(1);
			const first = parts.findIndex((part) => part.type === 'integer');
			const last = parts.findLastIndex(
				(part) => part.type === 'integer' || part.type === 'fraction'
			);
			const join = (from: number, to: number): string =>
				parts
					.slice(from, to)
					.map((part) => part.value)
					.join('')
					.trim();
			return { prefix: join(0, first), suffix: join(last + 1, parts.length) };
		}
		if (field.type === 'percent') {
			const [prefix, suffix] = percentSign.split('{n}').map((part) => part.trim());
			return { prefix, suffix };
		}
		return { prefix: '', suffix: field.type === 'number' ? (field.unit ?? '') : '' };
	}

	/** What an input beside its affixes opens on: the editor's text without them. */
	function bareText(field: FieldFormat, value: number): string {
		if (field.type === 'currency') {
			return currencyFormat(currencyOf(field), true, field.decimals ?? null)
				.formatToParts(value)
				.filter((part) =>
					['minusSign', 'integer', 'group', 'decimal', 'fraction'].includes(part.type)
				)
				.map((part) => part.value)
				.join('');
		}
		if (field.type === 'percent') {
			return formatNumber(value, { edit: true, decimals: field.decimals ?? null });
		}
		if (field.type === 'number') {
			return formatNumber(value, {
				edit: true,
				decimals: field.decimals ?? null,
				grouping: field.grouping !== false
			});
		}
		return formatAmount(field, value, true);
	}

	/** What a copied cell pastes as anywhere: every digit, ungrouped; an amount keeps its sign. */
	function copyValue(field: FieldFormat, value: Value | undefined): string {
		if (typeof value === 'number') {
			if (field.type === 'currency' || field.type === 'percent' || field.type === 'duration') {
				return formatAmount(field, value, true);
			}
			return plainNumber(value);
		}
		if (typeof value === 'boolean') {
			return value ? 'TRUE' : 'FALSE';
		}
		if (Array.isArray(value)) {
			return formatValue(field, value);
		}
		return typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
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
		formatValue,
		editText,
		readValue,
		copyValue,
		affixes,
		bareText
	};
}

export type LocaleFormats = ReturnType<typeof localeFormats>;

const REGION_CURRENCY: Record<string, string> = {
	US: 'USD',
	GB: 'GBP',
	CH: 'CHF',
	CA: 'CAD',
	AU: 'AUD',
	NZ: 'NZD',
	JP: 'JPY',
	CN: 'CNY',
	HK: 'HKD',
	SG: 'SGD',
	KR: 'KRW',
	IN: 'INR',
	BR: 'BRL',
	MX: 'MXN',
	SE: 'SEK',
	NO: 'NOK',
	DK: 'DKK',
	PL: 'PLN',
	CZ: 'CZK',
	TR: 'TRY',
	MA: 'MAD',
	ZA: 'ZAR',
	AE: 'AED'
};

/** The currency of the locale's region, the euro where none is known. */
export function localCurrency(locale?: string): string {
	const tag = locale ?? new Intl.NumberFormat().resolvedOptions().locale;
	return REGION_CURRENCY[new Intl.Locale(tag).maximize().region ?? ''] ?? 'EUR';
}

export const browserFormats = localeFormats();

export const {
	formatNumber,
	readNumber,
	plainNumber,
	formatDate,
	formatMonth,
	readDate,
	formatValue,
	editText,
	readValue,
	copyValue,
	affixes,
	bareText
} = browserFormats;
