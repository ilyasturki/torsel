import type { FieldFormat, FieldType, Value } from './model.ts';
import { imagesOf, imagesValue } from './images.ts';

const GROUPED = /^[-+]?\d{1,3}([,.])\d{3}(\1\d{3})*([,.]\d+)?$/u;

// One group alone stays a decimal: "1,234" is 1.234 where a comma marks decimals.
function ungrouped(text: string): string {
	const match = GROUPED.exec(text);
	if (match === null) {
		return text;
	}
	const [, separator, more, decimals] = match;
	return decimals?.[0] === separator || (more === undefined && decimals === undefined)
		? text
		: text.replaceAll(separator, '');
}

export function parseNumber(raw: string): number | null {
	const cleaned = ungrouped(raw.replace(/[\s  ]/gu, '')).replace(',', '.');

	if (cleaned === '' || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/iu.test(cleaned)) {
		return null;
	}

	const value = Number(cleaned);
	return Number.isFinite(value) ? value : null;
}

export function pad(value: number): string {
	return String(value).padStart(2, '0');
}

export function validDay(year: number, month: number, day: number): boolean {
	const date = new Date(Date.UTC(year, month - 1, day));
	return (
		date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
	);
}

/** `YYYY-MM-DD`, or `YYYY-MM-DDTHH:MM` when the source carries a time. */
export function parseDate(raw: string): string | null {
	const value = raw.trim();

	const iso =
		/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/u.exec(
			value
		);
	if (iso !== null) {
		const [, year, month, day, hours, minutes] = iso;
		if (!validDay(Number(year), Number(month), Number(day))) {
			return null;
		}
		return hours === undefined
			? `${year}-${month}-${day}`
			: `${year}-${month}-${day}T${hours}:${minutes}`;
	}

	const european = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/u.exec(value);
	if (european !== null) {
		const [, day, month, year] = european.map(Number);
		if (!validDay(year, month, day)) {
			return null;
		}
		return `${year}-${pad(month)}-${pad(day)}`;
	}

	return null;
}

const TRUE_WORDS = new Set(['true', 'vrai', 'oui', 'yes', 'x', '1', 'y', 'o']);
const FALSE_WORDS = new Set(['false', 'faux', 'non', 'no', '0', 'n', '']);

export function parseCheck(raw: string): boolean | null {
	const value = raw.trim().toLowerCase();

	if (TRUE_WORDS.has(value)) {
		return true;
	}

	return FALSE_WORDS.has(value) ? false : null;
}

export function hasTime(value: unknown): boolean {
	return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/u.test(value);
}

export function todayIso(now: Date = new Date()): string {
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function nowIso(now: Date = new Date()): string {
	return `${todayIso(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export function freshValue(field: Pick<FieldFormat, 'type'>, now: Date = new Date()): Value {
	if (field.type === 'date') {
		return todayIso(now);
	}
	return field.type === 'datetime' ? nowIso(now) : null;
}

export function nativeDateText(field: Pick<FieldFormat, 'type'>, value: unknown): string {
	if (typeof value !== 'string') {
		return '';
	}
	if (field.type === 'date') {
		return value.slice(0, 10);
	}
	return value.length === 10 ? `${value}T00:00` : value;
}

export const CURRENCIES = [
	'EUR',
	'USD',
	'GBP',
	'CHF',
	'CAD',
	'AUD',
	'NZD',
	'JPY',
	'CNY',
	'HKD',
	'SGD',
	'KRW',
	'INR',
	'BRL',
	'MXN',
	'SEK',
	'NOK',
	'DKK',
	'PLN',
	'CZK',
	'TRY',
	'MAD',
	'ZAR',
	'AED'
] as const;

// Longest first: "R$" must win over "$".
const SYMBOLS: [string, string][] = [
	['HK$', 'HKD'],
	['US$', 'USD'],
	['CA$', 'CAD'],
	['AU$', 'AUD'],
	['NZ$', 'NZD'],
	['MX$', 'MXN'],
	['R$', 'BRL'],
	['C$', 'CAD'],
	['A$', 'AUD'],
	['S$', 'SGD'],
	['$', 'USD'],
	['€', 'EUR'],
	['£', 'GBP'],
	['¥', 'JPY'],
	['₹', 'INR'],
	['₩', 'KRW'],
	['₺', 'TRY'],
	['zł', 'PLN']
];

const CODE = /(?<![A-Za-z])([A-Z]{3})(?![A-Za-z])/u;

export function currencyOf(field: Pick<FieldFormat, 'currency'>): string {
	return field.currency ?? 'EUR';
}

export function currencyIn(raw: string): string | null {
	const code = CODE.exec(raw)?.[1];
	if (code !== undefined && (CURRENCIES as readonly string[]).includes(code)) {
		return code;
	}
	return SYMBOLS.find(([symbol]) => raw.includes(symbol))?.[1] ?? null;
}

/** An amount, its currency's code or symbol on either side or left out. */
export function parseAmount(raw: string): number | null {
	const bare = raw.replace(new RegExp(CODE.source, 'gu'), '').replace(/[A-Z]{0,2}\p{Sc}|zł/gu, '');
	return parseNumber(bare.trim());
}

const PERCENT = /\s*[%٪]\s*$/u;

/** A percent in points: "25%" and "25" are both 25. */
export function parsePercent(raw: string): number | null {
	return parseNumber(raw.replace(PERCENT, '').trim());
}

export function withoutUnit(raw: string, unit: string | null | undefined): string {
	const text = raw.trim();
	return unit && text.toLowerCase().endsWith(unit.toLowerCase())
		? text.slice(0, text.length - unit.length).trim()
		: text;
}

export type RatingScale = { min: number; max: number; step: number };

/** At most ten stars, from 0 or 1, by whole or half points. */
export function ratingScale(field: Pick<FieldFormat, 'min' | 'max' | 'step'>): RatingScale {
	const min = field.min === 0 ? 0 : 1;
	const max = Math.min(10, Math.max(min + 1, Math.round(field.max ?? 5)));
	return { min, max, step: field.step === 0.5 ? 0.5 : 1 };
}

/** "4", "4/5", "7,5 / 10" or a row of stars. */
export function parseRating(raw: string): number | null {
	const text = raw.trim();
	if (text !== '' && /^[★⭐☆\s]+$/u.test(text)) {
		return [...text].filter((char) => char === '★' || char === '⭐').length;
	}
	const over = /^(.+?)\s*\/\s*\d+(?:[.,]\d+)?$/u.exec(text);
	return parseNumber(over === null ? text : over[1]);
}

export function onScale(value: number, scale: RatingScale): boolean {
	const steps = (value - scale.min) / scale.step;
	return value >= scale.min && value <= scale.max && Math.abs(steps - Math.round(steps)) < 1e-9;
}

/** The seconds one bare number counts for in a duration field. */
export function durationUnit(field: Pick<FieldFormat, 'seconds'>): number {
	return field.seconds ? 1 : 60;
}

const DURATION_UNITS: [RegExp, number][] = [
	[/^h(?:ours?|rs?)?$/u, 3600],
	[/^m(?:in(?:ute)?s?)?$/u, 60],
	[/^s(?:ec(?:ond)?s?)?$/u, 1]
];

function clockSeconds(parts: number[], unit: number): number | null {
	const [first, second, third] = parts;
	if (second > 59 || (third ?? 0) >= 60) {
		return null;
	}
	if (third !== undefined) {
		return first * 3600 + second * 60 + third;
	}
	return unit === 1 ? first * 60 + second : first * 3600 + second * 60;
}

function unitSeconds(body: string): number | null {
	let total = 0;
	let previous = Infinity;
	let rest = body;
	while (rest !== '') {
		const token = /^(\d+(?:\.\d+)?)\s*([a-z]*)\s*/u.exec(rest);
		if (token === null) {
			return null;
		}
		const [whole, amount, word] = token;
		// "1h30" and "2m15": a bare number after a unit counts in the next one down.
		const size =
			word === ''
				? previous === Infinity
					? undefined
					: previous / 60
				: DURATION_UNITS.find(([pattern]) => pattern.test(word))?.[1];
		if (size === undefined || size < 1 || size >= previous) {
			return null;
		}
		total += Number(amount) * size;
		previous = size;
		rest = rest.slice(whole.length);
	}
	return total;
}

/**
 * Seconds from `h:mm:ss`, from `h:mm` (`m:ss` when `unit` is a second), from "1h 30m" or "90s",
 * or from a bare number counted in `unit` seconds.
 */
export function parseDuration(raw: string, unit = 60): number | null {
	const text = raw
		.trim()
		.toLowerCase()
		.replace(/(\d),(\d)/gu, '$1.$2');
	const sign = /^[-−]/u.test(text) ? -1 : 1;
	const body = text.replace(/^[-+−]\s*/u, '');
	if (body === '') {
		return null;
	}

	const clock = /^(\d+):(\d{1,2})(?::(\d{1,2}(?:\.\d+)?))?$/u.exec(body);
	const bare = clock === null ? parseNumber(body) : null;
	const seconds =
		clock !== null
			? clockSeconds(
					clock
						.slice(1)
						.filter((part) => part !== undefined)
						.map(Number),
					unit
				)
			: bare !== null
				? bare * unit
				: unitSeconds(body);
	return seconds === null ? null : (sign * Math.round(seconds * 1000)) / 1000 || 0;
}

/** `h:mm`, or `h:mm:ss` with seconds: every locale reads a duration this way. */
export function formatDuration(seconds: number, withSeconds = false): string {
	const size = withSeconds ? 1 : 60;
	const whole = Math.round(Math.abs(seconds) / size) * size;
	const sign = seconds < 0 && whole > 0 ? '-' : '';
	const clock = `${sign}${Math.floor(whole / 3600)}:${pad(Math.floor((whole % 3600) / 60))}`;
	return withSeconds ? `${clock}:${pad(whole % 60)}` : clock;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const SCHEME = /^[a-z][a-z\d+.-]*:\/\//iu;
// Any other scheme, javascript:// among them, must never reach an href.
const WEB = /^https?:\/\//iu;
const DOMAIN = /^[^\s@/:]+\.[a-z]{2,}(?::\d+)?(?:[/?#]\S*)?$/iu;
const PHONE = /^\+?[\d\s().\-/]+$/u;

export function isEmail(text: string): boolean {
	return EMAIL.test(text);
}

export function isUrl(text: string): boolean {
	return SCHEME.test(text) ? WEB.test(text) && !/\s/u.test(text) : DOMAIN.test(text);
}

export function isPhone(text: string): boolean {
	const digits = text.replace(/\D/gu, '').length;
	return PHONE.test(text) && digits >= 3 && digits <= 20;
}

export function hrefOf(type: FieldType, value: string): string {
	if (type === 'email') {
		return `mailto:${value}`;
	}
	if (type === 'phone') {
		return `tel:${value.replace(/[^\d+]/gu, '')}`;
	}
	return WEB.test(value) ? value : `https://${value}`;
}

export const CHOICES_JOIN = ', ';

export function splitChoices(raw: string): string[] {
	return [...new Set(raw.split(/[,;]/u).map((name) => name.trim()))].filter((name) => name !== '');
}

/** The type fresh values read as. A word stays text: one sample can't tell a choice from a note. */
export function typeOfValues(values: unknown[]): Detected {
	if (values.every((value) => typeof value === 'boolean')) {
		return { type: 'check' };
	}
	if (values.every((value) => typeof value === 'number')) {
		return { type: 'number' };
	}
	if (values.every((value) => typeof value === 'string' || typeof value === 'number')) {
		const detected = detectType(values.map(String));
		return detected === null || detected.type === 'check' ? { type: 'text' } : detected;
	}
	return { type: 'text' };
}

export type Detected = { type: FieldType } & Partial<Pick<FieldFormat, 'currency' | 'seconds'>>;

/** The type every text reads as beyond doubt, or null; a rating reads as a number. */
export function detectType(texts: string[]): Detected | null {
	const filled = texts.map((text) => text.trim()).filter((text) => text !== '');
	const all = (test: (text: string) => boolean): boolean => filled.length > 0 && filled.every(test);

	// A leading "+" or "0" and a phone's length: no amount is written that way.
	if (all((text) => isPhone(text) && /^(?:\+|0\d)/u.test(text) && /(?:\d\D*){9}/u.test(text))) {
		return { type: 'phone' };
	}
	if (all((text) => parseNumber(text) !== null)) {
		return { type: 'number' };
	}
	if (all((text) => PERCENT.test(text) && parsePercent(text) !== null)) {
		return { type: 'percent' };
	}
	if (all((text) => currencyIn(text) !== null && parseAmount(text) !== null)) {
		const codes = new Set(filled.map(currencyIn));
		return { type: 'currency', currency: codes.size === 1 ? [...codes][0] : null };
	}
	if (all((text) => /^-?\d+:\d{2}(?::\d{2})?$/u.test(text) && parseDuration(text) !== null)) {
		return { type: 'duration', seconds: filled.some((text) => /:\d{2}:/u.test(text)) };
	}
	if (all((text) => parseDate(text) !== null)) {
		return { type: filled.some((text) => hasTime(parseDate(text))) ? 'datetime' : 'date' };
	}
	if (all((text) => parseCheck(text) !== null)) {
		return { type: 'check' };
	}
	if (all(isEmail)) {
		return { type: 'email' };
	}
	if (all((text) => /^(?:https?:\/\/|www\.)\S+$/iu.test(text))) {
		return { type: 'url' };
	}
	return null;
}

function trimmed(raw: unknown): string | null {
	const value = typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? String(raw) : null;
	return value === null || value === '' ? null : value;
}

function amount(raw: unknown, read: (text: string) => number | null): number | null {
	if (typeof raw === 'number') {
		return Number.isFinite(raw) ? raw : null;
	}
	return typeof raw === 'string' ? read(raw) : null;
}

/** What a value becomes once stored in a field of this type; null when it cannot be. */
export function coerce(field: FieldFormat, raw: unknown): Value {
	if (raw === undefined || raw === null) {
		return null;
	}

	switch (field.type) {
		case 'number':
			return amount(raw, (text) => parseNumber(withoutUnit(text, field.unit)));
		case 'currency':
			return amount(raw, parseAmount);
		case 'percent':
			return amount(raw, parsePercent);
		case 'rating': {
			const value = amount(raw, parseRating);
			return value !== null && onScale(value, ratingScale(field)) ? value : null;
		}
		case 'duration':
			return amount(raw, (text) => parseDuration(text, durationUnit(field)));
		case 'date':
		case 'datetime': {
			if (raw instanceof Date) {
				if (Number.isNaN(raw.getTime())) {
					return null;
				}
				return field.type === 'date' ? todayIso(raw) : nowIso(raw);
			}
			const day = typeof raw === 'string' ? parseDate(raw) : null;
			return field.type === 'date' ? (day?.slice(0, 10) ?? null) : day;
		}
		case 'check': {
			if (typeof raw === 'boolean') {
				return raw;
			}
			if (typeof raw === 'number') {
				return raw !== 0;
			}
			return typeof raw === 'string' ? (parseCheck(raw) ?? false) : null;
		}
		case 'choices': {
			const names = Array.isArray(raw)
				? [...new Set(raw.map(trimmed).filter((name) => name !== null))]
				: typeof raw === 'string'
					? splitChoices(raw)
					: [];
			return names.length === 0 ? null : names;
		}
		case 'formula':
			return null;
		case 'image':
			return imagesValue(imagesOf(raw as Value));
		case 'url': {
			const value = trimmed(raw);
			return value !== null && isUrl(value) ? value : null;
		}
		case 'email': {
			const value = trimmed(raw);
			return value !== null && isEmail(value) ? value : null;
		}
		case 'phone': {
			const value = trimmed(raw);
			return value !== null && isPhone(value) ? value : null;
		}
		case 'choice':
		case 'link':
			return trimmed(raw);
		case 'text':
		case 'longtext': {
			const value = typeof raw === 'string' ? raw : typeof raw === 'number' ? String(raw) : null;
			return value === null || value === '' ? null : value;
		}
	}
}
