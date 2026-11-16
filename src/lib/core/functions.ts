import type { SqlValue } from '@sqlite.org/sqlite-wasm';

import type { Sqlite3 } from './memory-engine.ts';

type In = SqlValue | boolean | undefined;
type Out = string | number | null;

export type ArgName =
	| 'value'
	| 'text'
	| 'count'
	| 'start'
	| 'length'
	| 'search'
	| 'replacement'
	| 'occurrence'
	| 'times'
	| 'delimiter'
	| 'skipEmpty'
	| 'pattern'
	| 'date'
	| 'startDate'
	| 'endDate'
	| 'unit'
	| 'months'
	| 'type'
	| 'places'
	| 'number'
	| 'divisor'
	| 'power'
	| 'low'
	| 'high'
	| 'condition'
	| 'ifTrue'
	| 'ifFalse'
	| 'fallback'
	| 'expression'
	| 'case'
	| 'range'
	| 'criterion'
	| 'sumRange';

export type Arg = { name: ArgName; optional?: boolean; repeats?: boolean };

export type FormulaFunction = { name: string; args: Arg[] };

type Scalar = FormulaFunction & {
	run: (args: In[]) => Out | boolean;
	/** Reads the clock or chance: SQLite must call it again on every row. */
	volatile?: boolean;
};

type Tally = { sum: number; count: number; seen: Map<string, number> };

type Aggregate = FormulaFunction & {
	step: (tally: Tally, args: In[], sign: 1 | -1) => void;
	result: (tally: Tally) => Out;
};

// The longest text a function builds, as SQLite's own length cap on the server.
const MAX_TEXT = 1_000_000;

function a(name: ArgName, more: Omit<Arg, 'name'> = {}): Arg {
	return { name, ...more };
}

function isBlank(value: In): boolean {
	return value === null || value === undefined || value === '';
}

function num(value: In): number | null {
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (typeof value === 'bigint') return Number(value);
	if (typeof value === 'boolean') return value ? 1 : 0;
	if (typeof value === 'string' && value.trim() !== '') {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}

/** A blank reads as 0, as an empty cell does in Sheets. */
function numOr0(value: In): number | null {
	return isBlank(value) ? 0 : num(value);
}

/** A blank reads as "", as an empty cell does in Sheets. */
function str(value: In): string | null {
	if (isBlank(value)) return '';
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'bigint') return String(value);
	if (typeof value === 'boolean') return value ? '1' : '0';
	return null;
}

function truthy(value: In): boolean {
	const n = num(value);
	return n !== null && n !== 0;
}

function chars(text: string): string[] {
	return Array.from(text);
}

function whole(value: In, fallback?: number): number | null {
	const n = value === undefined && fallback !== undefined ? fallback : numOr0(value);
	return n === null ? null : Math.trunc(n);
}

function joined(parts: string[], glue: string): string | null {
	const size = parts.reduce((total, part) => total + part.length, glue.length * parts.length);
	return size > MAX_TEXT ? null : parts.join(glue);
}

type Day = { y: number; m: number; d: number; h: number; min: number; s: number };

const DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?(?:Z)?$/u;

function day(value: In): Day | null {
	if (typeof value !== 'string') return null;
	const match = DATE.exec(value.trim());
	if (match === null) return null;
	const [y, m, d, h, min, s] = match.slice(1).map((part) => Number(part ?? 0));
	const at = new Date(Date.UTC(y, m - 1, d));
	if (at.getUTCMonth() !== m - 1 || h > 23 || min > 59 || s > 59) return null;
	return { y, m, d, h, min, s };
}

function pad(n: number, width = 2): string {
	return String(n).padStart(width, '0');
}

function iso(y: number, m: number, d: number): string {
	return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

function fromUtc(ms: number): string {
	const at = new Date(ms);
	return iso(at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate());
}

function epochDay(date: Day): number {
	return Date.UTC(date.y, date.m - 1, date.d) / 86_400_000;
}

function monthDays(y: number, m: number): number {
	return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// 0 is Sunday.
function weekday(date: Day): number {
	return new Date(Date.UTC(date.y, date.m - 1, date.d)).getUTCDay();
}

function shiftMonths(date: Day, months: number): { y: number; m: number } {
	const index = date.y * 12 + (date.m - 1) + months;
	return { y: Math.floor(index / 12), m: (((index % 12) + 12) % 12) + 1 };
}

function dateDif(start: Day, end: Day, unit: string): number | null {
	const days = epochDay(end) - epochDay(start);
	if (days < 0) return null;
	const months = (end.y - start.y) * 12 + (end.m - start.m) - (end.d < start.d ? 1 : 0);
	switch (unit.toUpperCase()) {
		case 'D':
			return days;
		case 'M':
			return months;
		case 'Y':
			return Math.floor(months / 12);
		case 'YM':
			return months % 12;
		case 'MD': {
			const { y, m } = shiftMonths(start, months);
			return epochDay(end) - Date.UTC(y, m - 1, Math.min(start.d, monthDays(y, m))) / 86_400_000;
		}
		case 'YD': {
			let y = end.y;
			if (end.m < start.m || (end.m === start.m && end.d < start.d)) y -= 1;
			const d = Math.min(start.d, monthDays(y, start.m));
			return epochDay(end) - Date.UTC(y, start.m - 1, d) / 86_400_000;
		}
		default:
			return null;
	}
}

function weekdaysBetween(from: number, to: number): number {
	// `from` and `to` are epoch days; 1970-01-01 was a Thursday.
	const count = (until: number): number => {
		const weeks = Math.floor(until / 7);
		let total = weeks * 5;
		for (let d = weeks * 7; d < until; d += 1) {
			const dow = (((d + 4) % 7) + 7) % 7;
			if (dow !== 0 && dow !== 6) total += 1;
		}
		return total;
	};
	return count(to + 1) - count(from);
}

function isoWeek(date: Day): number {
	const at = new Date(Date.UTC(date.y, date.m - 1, date.d));
	const dow = at.getUTCDay() || 7;
	at.setUTCDate(at.getUTCDate() + 4 - dow);
	const yearStart = Date.UTC(at.getUTCFullYear(), 0, 1);
	return Math.ceil(((at.getTime() - yearStart) / 86_400_000 + 1) / 7);
}

function wildcard(pattern: string): RegExp {
	let source = '';
	for (let i = 0; i < pattern.length; i += 1) {
		const char = pattern[i];
		if (char === '~' && i + 1 < pattern.length) {
			i += 1;
			source += pattern[i].replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
		} else if (char === '*') source += '.*';
		else if (char === '?') source += '.';
		else source += char.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
	}
	return new RegExp(`^${source}$`, 'iu');
}

export function meets(value: In, criterion: In): boolean {
	if (typeof criterion === 'number' || typeof criterion === 'bigint') {
		return num(value) === Number(criterion);
	}
	const text = str(criterion) ?? '';
	const match = /^(<=|>=|<>|<|>|=)?(.*)$/su.exec(text) as RegExpExecArray;
	const op = match[1] ?? '=';
	const operand = match[2];
	if (operand === '') {
		return op === '<>' ? !isBlank(value) : op === '=' ? isBlank(value) : false;
	}
	const wanted = num(operand);
	if (wanted !== null) {
		const have = num(value);
		if (have === null) return op === '<>';
		switch (op) {
			case '<':
				return have < wanted;
			case '<=':
				return have <= wanted;
			case '>':
				return have > wanted;
			case '>=':
				return have >= wanted;
			case '<>':
				return have !== wanted;
			default:
				return have === wanted;
		}
	}
	const have = str(value) ?? '';
	if (op === '=' || op === '<>') {
		const same = wildcard(operand).test(have);
		return op === '=' ? same : !same;
	}
	const order = have.localeCompare(operand, undefined, { sensitivity: 'base' });
	return op === '<' ? order < 0 : op === '<=' ? order <= 0 : op === '>' ? order > 0 : order >= 0;
}

function regex(pattern: In): RegExp | null {
	const source = str(pattern);
	if (source === null) return null;
	try {
		return new RegExp(source, 'u');
	} catch {
		return null;
	}
}

function replaceCapped(text: string, pattern: RegExp, replacement: string): string | null {
	let size = text.length;
	const global = new RegExp(pattern.source, `${pattern.flags}g`);
	try {
		return text.replace(global, (...groups: unknown[]) => {
			const matched = groups[0] as string;
			const out = replacement.replace(/\$(\d+|&|\$)/gu, (_, ref: string) => {
				if (ref === '$') return '$';
				if (ref === '&') return matched;
				const group = groups[Number(ref)];
				return typeof group === 'string' ? group : '';
			});
			size += out.length - matched.length;
			if (size > MAX_TEXT) throw new RangeError();
			return out;
		});
	} catch {
		return null;
	}
}

function roundTo(value: In, places: In, mode: (n: number) => number): number | null {
	const n = numOr0(value);
	const p = whole(places, 0);
	if (n === null || p === null) return null;
	const factor = 10 ** p;
	const scaled = Math.abs(n) * factor;
	// Strips the float noise of 1.005 * 100 = 100.49999999999999 before rounding.
	const out = mode(Number(scaled.toPrecision(15))) / factor;
	return n < 0 ? -out : out;
}

function dated(run: (date: Day, args: In[]) => Out): (args: In[]) => Out {
	return (args) => {
		const date = day(args[0]);
		return date === null ? null : run(date, args);
	};
}

const SCALARS: Scalar[] = [
	{
		name: 'AVERAGE',
		args: [a('value'), a('value', { repeats: true })],
		run: (args) => {
			const values = args.map(num).filter((n) => n !== null);
			return values.length === 0 ? null : values.reduce((x, y) => x + y, 0) / values.length;
		}
	},
	{
		name: 'IFS',
		args: [a('condition'), a('ifTrue'), a('condition', { repeats: true })],
		run: (args) => {
			for (let i = 0; i + 1 < args.length; i += 2) {
				if (truthy(args[i])) return (args[i + 1] ?? null) as Out;
			}
			return null;
		}
	},
	{
		name: 'IFERROR',
		args: [a('value'), a('fallback', { optional: true })],
		run: ([value, fallback]) => (value ?? fallback ?? null) as Out
	},
	{
		name: 'SWITCH',
		args: [a('expression'), a('case'), a('ifTrue', { repeats: true })],
		run: ([subject, ...rest]) => {
			for (let i = 0; i + 1 < rest.length; i += 2) {
				const wanted = rest[i];
				const same =
					num(subject) !== null && num(wanted) !== null
						? num(subject) === num(wanted)
						: str(subject) === str(wanted);
				if (same) return (rest[i + 1] ?? null) as Out;
			}
			return rest.length % 2 === 1 ? ((rest[rest.length - 1] ?? null) as Out) : null;
		}
	},
	{ name: 'ISBLANK', args: [a('value')], run: ([value]) => isBlank(value) },
	{
		name: 'ISNUMBER',
		args: [a('value')],
		run: ([value]) => typeof value === 'number' || typeof value === 'bigint'
	},
	{ name: 'ISTEXT', args: [a('value')], run: ([value]) => typeof value === 'string' },
	{
		name: 'INT',
		args: [a('value')],
		run: ([value]) => {
			const n = numOr0(value);
			return n === null ? null : Math.floor(n);
		}
	},
	{
		name: 'ROUNDUP',
		args: [a('value'), a('places', { optional: true })],
		run: ([value, places]) => roundTo(value, places, Math.ceil)
	},
	{
		name: 'ROUNDDOWN',
		args: [a('value'), a('places', { optional: true })],
		run: ([value, places]) => roundTo(value, places, Math.floor)
	},
	{ name: 'RAND', args: [], run: () => Math.random(), volatile: true },
	{
		name: 'RANDBETWEEN',
		args: [a('low'), a('high')],
		volatile: true,
		run: ([low, high]) => {
			const lo = num(low);
			const hi = num(high);
			if (lo === null || hi === null) return null;
			const from = Math.ceil(lo);
			const to = Math.floor(hi);
			return to < from ? null : from + Math.floor(Math.random() * (to - from + 1));
		}
	},
	{
		name: 'LEFT',
		args: [a('text'), a('count', { optional: true })],
		run: ([value, count]) => {
			const text = str(value);
			const n = whole(count, 1);
			return text === null || n === null || n < 0 ? null : chars(text).slice(0, n).join('');
		}
	},
	{
		name: 'RIGHT',
		args: [a('text'), a('count', { optional: true })],
		run: ([value, count]) => {
			const text = str(value);
			const n = whole(count, 1);
			if (text === null || n === null || n < 0) return null;
			return n === 0 ? '' : chars(text).slice(-n).join('');
		}
	},
	{
		name: 'MID',
		args: [a('text'), a('start'), a('length')],
		run: ([value, start, length]) => {
			const text = str(value);
			const from = whole(start);
			const n = whole(length);
			if (text === null || from === null || n === null || from < 1 || n < 0) return null;
			return chars(text)
				.slice(from - 1, from - 1 + n)
				.join('');
		}
	},
	{
		name: 'LEN',
		args: [a('text')],
		run: ([value]) => {
			const text = str(value);
			return text === null ? null : chars(text).length;
		}
	},
	{
		name: 'CONCATENATE',
		args: [a('text', { repeats: true })],
		run: (args) => {
			const parts = args.map(str);
			return parts.includes(null) ? null : joined(parts as string[], '');
		}
	},
	{
		name: 'TEXTJOIN',
		args: [a('delimiter'), a('skipEmpty'), a('text', { repeats: true })],
		run: ([delimiter, skip, ...values]) => {
			const glue = str(delimiter);
			const parts = values.map(str);
			if (glue === null || parts.includes(null)) return null;
			const kept = truthy(skip) ? parts.filter((part) => part !== '') : parts;
			return joined(kept as string[], glue);
		}
	},
	{
		name: 'PROPER',
		args: [a('text')],
		run: ([value]) =>
			str(value)
				?.toLocaleLowerCase()
				.replace(/(^|[^\p{L}])(\p{L})/gu, (_, before: string, letter: string) => {
					return before + letter.toLocaleUpperCase();
				}) ?? null
	},
	{
		name: 'SUBSTITUTE',
		args: [a('text'), a('search'), a('replacement'), a('occurrence', { optional: true })],
		run: ([value, search, replacement, occurrence]) => {
			const text = str(value);
			const find = str(search);
			const put = str(replacement);
			if (text === null || find === null || put === null) return null;
			if (find === '') return text;
			const parts = text.split(find);
			if (occurrence === undefined) {
				const size = text.length + (parts.length - 1) * (put.length - find.length);
				return size > MAX_TEXT ? null : parts.join(put);
			}
			const nth = whole(occurrence);
			if (nth === null || nth < 1) return null;
			if (nth >= parts.length) return text;
			return parts.slice(0, nth).join(find) + put + parts.slice(nth).join(find);
		}
	},
	{
		name: 'FIND',
		args: [a('search'), a('text'), a('start', { optional: true })],
		run: ([search, value, start]) => position(search, value, start, false)
	},
	{
		name: 'SEARCH',
		args: [a('search'), a('text'), a('start', { optional: true })],
		run: ([search, value, start]) => position(search, value, start, true)
	},
	{
		name: 'REPT',
		args: [a('text'), a('times')],
		run: ([value, times]) => {
			const text = str(value);
			const n = whole(times);
			if (text === null || n === null || n < 0 || text.length * n > MAX_TEXT) return null;
			return text.repeat(n);
		}
	},
	{
		name: 'VALUE',
		args: [a('text')],
		run: ([value]) => (typeof value === 'string' ? num(value.trim()) : num(value))
	},
	{
		name: 'EXACT',
		args: [a('text'), a('text')],
		run: ([left, right]) => str(left) === str(right)
	},
	{
		name: 'REGEXMATCH',
		args: [a('text'), a('pattern')],
		run: ([value, pattern]) => {
			const text = str(value);
			const re = regex(pattern);
			return text === null || re === null ? null : re.test(text);
		}
	},
	{
		name: 'REGEXEXTRACT',
		args: [a('text'), a('pattern')],
		run: ([value, pattern]) => {
			const text = str(value);
			const re = regex(pattern);
			const match = text === null || re === null ? null : re.exec(text);
			return match === null ? null : (match[1] ?? match[0]);
		}
	},
	{
		name: 'REGEXREPLACE',
		args: [a('text'), a('pattern'), a('replacement')],
		run: ([value, pattern, replacement]) => {
			const text = str(value);
			const re = regex(pattern);
			const put = str(replacement);
			return text === null || re === null || put === null ? null : replaceCapped(text, re, put);
		}
	},
	{
		name: 'TODAY',
		args: [],
		volatile: true,
		run: () => {
			const now = new Date();
			return iso(now.getFullYear(), now.getMonth() + 1, now.getDate());
		}
	},
	{
		name: 'NOW',
		args: [],
		volatile: true,
		run: () => {
			const now = new Date();
			const date = iso(now.getFullYear(), now.getMonth() + 1, now.getDate());
			return `${date}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
		}
	},
	{ name: 'YEAR', args: [a('date')], run: dated((date) => date.y) },
	{ name: 'MONTH', args: [a('date')], run: dated((date) => date.m) },
	{ name: 'DAY', args: [a('date')], run: dated((date) => date.d) },
	{ name: 'HOUR', args: [a('date')], run: dated((date) => date.h) },
	{ name: 'MINUTE', args: [a('date')], run: dated((date) => date.min) },
	{
		name: 'WEEKDAY',
		args: [a('date'), a('type', { optional: true })],
		run: dated((date, [, type]) => {
			const dow = weekday(date);
			switch (whole(type, 1)) {
				case 1:
					return dow + 1;
				case 2:
					return ((dow + 6) % 7) + 1;
				case 3:
					return (dow + 6) % 7;
				default:
					return null;
			}
		})
	},
	{
		name: 'WEEKNUM',
		args: [a('date'), a('type', { optional: true })],
		run: dated((date, [, type]) => {
			const kind = whole(type, 1);
			if (kind !== 1 && kind !== 2) return null;
			const jan1 = weekday({ ...date, m: 1, d: 1 });
			const offset = kind === 1 ? jan1 : (jan1 + 6) % 7;
			const dayOfYear = epochDay(date) - Date.UTC(date.y, 0, 1) / 86_400_000;
			return Math.floor((dayOfYear + offset) / 7) + 1;
		})
	},
	{ name: 'ISOWEEKNUM', args: [a('date')], run: dated((date) => isoWeek(date)) },
	{
		name: 'DAYS',
		args: [a('endDate'), a('startDate')],
		run: ([end, start]) => {
			const to = day(end);
			const from = day(start);
			return to === null || from === null ? null : epochDay(to) - epochDay(from);
		}
	},
	{
		name: 'DATEDIF',
		args: [a('startDate'), a('endDate'), a('unit')],
		run: ([start, end, unit]) => {
			const from = day(start);
			const to = day(end);
			const kind = str(unit);
			return from === null || to === null || kind === null ? null : dateDif(from, to, kind);
		}
	},
	{
		name: 'EDATE',
		args: [a('startDate'), a('months')],
		run: dated((date, [, months]) => {
			const n = whole(months);
			if (n === null) return null;
			const { y, m } = shiftMonths(date, n);
			return iso(y, m, Math.min(date.d, monthDays(y, m)));
		})
	},
	{
		name: 'EOMONTH',
		args: [a('startDate'), a('months')],
		run: dated((date, [, months]) => {
			const n = whole(months);
			if (n === null) return null;
			const { y, m } = shiftMonths(date, n);
			return fromUtc(Date.UTC(y, m, 0));
		})
	},
	{
		name: 'NETWORKDAYS',
		args: [a('startDate'), a('endDate')],
		run: ([start, end]) => {
			const from = day(start);
			const to = day(end);
			if (from === null || to === null) return null;
			const a0 = epochDay(from);
			const b0 = epochDay(to);
			return a0 <= b0 ? weekdaysBetween(a0, b0) : -weekdaysBetween(b0, a0);
		}
	}
];

function position(search: In, value: In, start: In, fold: boolean): number | null {
	const needle = str(search);
	const text = str(value);
	const from = whole(start, 1);
	if (needle === null || text === null || from === null || from < 1) return null;
	const hay = chars(fold ? text.toLocaleLowerCase() : text);
	const find = chars(fold ? needle.toLocaleLowerCase() : needle);
	for (let i = from - 1; i + find.length <= hay.length; i += 1) {
		if (find.every((char, k) => hay[i + k] === char)) return i + 1;
	}
	return null;
}

function counted(tally: Tally, key: string, sign: 1 | -1): void {
	const next = (tally.seen.get(key) ?? 0) + sign;
	if (next === 0) tally.seen.delete(key);
	else tally.seen.set(key, next);
}

function conditional(name: string, result: (tally: Tally) => Out): Aggregate & { args: Arg[] } {
	return {
		name,
		args: [a('range'), a('criterion'), a('sumRange', { optional: true })],
		step: (tally, [value, criterion, other], sign) => {
			if (!meets(value, criterion)) return;
			const n = num(other === undefined ? value : other);
			if (n !== null) {
				tally.sum += sign * n;
				tally.count += sign;
			}
		},
		result
	};
}

const AGGREGATES: Aggregate[] = [
	{
		name: 'AVERAGE',
		args: [a('value')],
		step: (tally, [value], sign) => {
			const n = typeof value === 'string' ? null : num(value);
			if (n !== null) {
				tally.sum += sign * n;
				tally.count += sign;
			}
		},
		result: (tally) => (tally.count === 0 ? null : tally.sum / tally.count)
	},
	{
		name: 'COUNTA',
		args: [a('value')],
		step: (tally, [value], sign) => {
			if (!isBlank(value)) tally.count += sign;
		},
		result: (tally) => tally.count
	},
	{
		name: 'COUNTUNIQUE',
		args: [a('value')],
		step: (tally, [value], sign) => {
			if (!isBlank(value)) counted(tally, `${typeof value}:${String(value)}`, sign);
		},
		result: (tally) => tally.seen.size
	},
	{
		name: 'COUNTIF',
		args: [a('range'), a('criterion')],
		step: (tally, [value, criterion], sign) => {
			if (meets(value, criterion)) tally.count += sign;
		},
		result: (tally) => tally.count
	},
	conditional('SUMIF', (tally) => tally.sum),
	conditional('AVERAGEIF', (tally) => (tally.count === 0 ? null : tally.sum / tally.count))
];

/** What SQLite already answers to under the Sheets name, listed for the formula editor. */
const NATIVE: FormulaFunction[] = [
	{ name: 'IF', args: [a('condition'), a('ifTrue'), a('ifFalse')] },
	{ name: 'SUM', args: [a('value')] },
	{ name: 'COUNT', args: [a('value')] },
	{ name: 'MIN', args: [a('value', { repeats: true })] },
	{ name: 'MAX', args: [a('value', { repeats: true })] },
	{ name: 'MEDIAN', args: [a('value')] },
	{ name: 'ROUND', args: [a('value'), a('places', { optional: true })] },
	{ name: 'ABS', args: [a('value')] },
	{ name: 'MOD', args: [a('value'), a('divisor')] },
	{ name: 'POWER', args: [a('number'), a('power')] },
	{ name: 'SQRT', args: [a('value')] },
	{ name: 'CEILING', args: [a('value')] },
	{ name: 'FLOOR', args: [a('value')] },
	{ name: 'UPPER', args: [a('text')] },
	{ name: 'LOWER', args: [a('text')] },
	{ name: 'TRIM', args: [a('text')] },
	{ name: 'CONCAT', args: [a('text', { repeats: true })] },
	{ name: 'COALESCE', args: [a('value', { repeats: true })] }
];

function arities(args: Arg[]): number[] {
	if (args.some((arg) => arg.repeats)) return [-1];
	const most = args.length;
	const least = args.filter((arg) => !arg.optional).length;
	return Array.from({ length: most - least + 1 }, (_, i) => least + i);
}

export const FUNCTIONS: FormulaFunction[] = [...NATIVE, ...SCALARS, ...AGGREGATES]
	.filter((fn, index, all) => all.findIndex((other) => other.name === fn.name) === index)
	.map(({ name, args }) => ({ name, args }))
	.sort((left, right) => left.name.localeCompare(right.name));

function signature({ name, args }: FormulaFunction): string {
	const list = args.map((arg) => `${arg.name}${arg.repeats ? '…' : ''}${arg.optional ? '?' : ''}`);
	return `${name}(${list.join(', ')})`;
}

/** What `registerFunctions` adds to SQLite, as NAME(args): the SQL a query may call beside SQLite's own. */
export const REGISTERED: string[] = [...SCALARS, ...AGGREGATES]
	.filter((fn, index, all) => all.findIndex((other) => other.name === fn.name) === index)
	.map(signature)
	.sort();

/** The functions that fold rows into one: a rollup over linked rows needs one of these. */
export const AGGREGATE_NAMES = new Set([
	'SUM',
	'TOTAL',
	'AVG',
	'COUNT',
	'MIN',
	'MAX',
	'MEDIAN',
	'GROUP_CONCAT',
	'STRING_AGG',
	...AGGREGATES.map((fn) => fn.name)
]);

function out(value: Out | boolean | undefined): Out {
	if (typeof value === 'boolean') return value ? 1 : 0;
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	return value ?? null;
}

type Db = InstanceType<Sqlite3['oo1']['DB']>;

export function registerFunctions(sqlite3: Sqlite3, db: Db): void {
	for (const fn of SCALARS) {
		for (const arity of arities(fn.args)) {
			db.createFunction({
				name: fn.name.toLowerCase(),
				arity,
				deterministic: fn.volatile !== true,
				innocuous: true,
				xFunc: (_ctx: number, ...args: In[]) => out(fn.run(args))
			});
		}
	}

	const { capi } = sqlite3;
	const tallies = new Map<number, Tally>();
	const tallyOf = (ctx: number, open: boolean): Tally | undefined => {
		const at = capi.sqlite3_aggregate_context(ctx, open ? 1 : 0);
		if (at === 0) return undefined;
		let tally = tallies.get(at);
		if (tally === undefined && open) {
			tally = { sum: 0, count: 0, seen: new Map() };
			tallies.set(at, tally);
		}
		return tally;
	};
	const empty: Tally = { sum: 0, count: 0, seen: new Map() };

	for (const fn of AGGREGATES) {
		for (const arity of arities(fn.args)) {
			db.createFunction({
				name: fn.name.toLowerCase(),
				arity,
				deterministic: true,
				innocuous: true,
				xStep: (ctx: number, ...args: In[]) => fn.step(tallyOf(ctx, true) as Tally, args, 1),
				xInverse: (ctx: number, ...args: In[]) => fn.step(tallyOf(ctx, true) as Tally, args, -1),
				xValue: (ctx: number) => out(fn.result(tallyOf(ctx, false) ?? empty)),
				xFinal: (ctx: number) => {
					const at = capi.sqlite3_aggregate_context(ctx, 0);
					const result = out(fn.result(tallies.get(at) ?? empty));
					tallies.delete(at);
					return result;
				}
			});
		}
	}
}
