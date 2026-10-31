import type { FieldDef, Value } from '../core/model.ts';

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

export function formatNumber(value: number): string {
	return numberFormat.format(value);
}

const decimal =
	numberFormat.formatToParts(1.5).find((part) => part.type === 'decimal')?.value ?? '.';

/** Every digit and no grouping, so it reads back through `parseNumber`. */
export function plainNumber(value: number): string {
	return String(value).replace('.', decimal);
}

export function formatDate(iso: string, withYear = false): string {
	const [year, month, day] = iso.slice(0, 10).split('-').map(Number);
	if (!year || !month || !day) {
		return iso;
	}
	const showYear = withYear || year !== new Date().getFullYear();
	const date = new Date(year, month - 1, day).toLocaleDateString(undefined, {
		day: 'numeric',
		month: 'short',
		year: showYear ? 'numeric' : undefined
	});
	return iso.length > 10 ? `${date} ${iso.slice(11, 16)}` : date;
}

export function formatMonth(iso: string): string {
	const [year, month] = iso.split('-').map(Number);
	return month
		? new Date(year, month - 1, 1).toLocaleDateString(undefined, {
				month: 'short',
				year: 'numeric'
			})
		: iso;
}

export function formatValue(field: Pick<FieldDef, 'type'>, value: Value | undefined): string {
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
		return field.type === 'date' ? formatDate(value) : value;
	}
	return JSON.stringify(value);
}
