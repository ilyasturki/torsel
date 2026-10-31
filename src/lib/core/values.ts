import type { FieldDef, Value } from './model.ts';

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

function pad(value: number): string {
	return String(value).padStart(2, '0');
}

function validDay(year: number, month: number, day: number): boolean {
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

export function todayIso(now: Date = new Date()): string {
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** What a value becomes once stored in a field of this type; null when it cannot be. */
export function coerce(field: Pick<FieldDef, 'type'>, raw: unknown): Value {
	if (raw === undefined || raw === null) {
		return null;
	}

	switch (field.type) {
		case 'number': {
			if (typeof raw === 'number') {
				return Number.isFinite(raw) ? raw : null;
			}
			return typeof raw === 'string' ? parseNumber(raw) : null;
		}
		case 'date': {
			if (raw instanceof Date) {
				return Number.isNaN(raw.getTime()) ? null : todayIso(raw);
			}
			return typeof raw === 'string' ? parseDate(raw) : null;
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
		case 'formula':
			return null;
		case 'text':
		case 'choice':
		case 'link': {
			const value = typeof raw === 'string' ? raw : typeof raw === 'number' ? String(raw) : null;
			if (value === null) {
				return null;
			}
			const trimmed = field.type === 'text' ? value : value.trim();
			return trimmed === '' ? null : trimmed;
		}
	}
}
