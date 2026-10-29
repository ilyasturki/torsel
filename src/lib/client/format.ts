import type { FieldDef, Value } from '../core/model.ts';

const numberFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

export function formatNumber(value: number): string {
	return numberFormat.format(value);
}

const MONTHS = [
	'janv.',
	'févr.',
	'mars',
	'avr.',
	'mai',
	'juin',
	'juil.',
	'août',
	'sept.',
	'oct.',
	'nov.',
	'déc.'
];

export function formatDate(iso: string, withYear = false): string {
	const [year, month, day] = iso.slice(0, 10).split('-').map(Number);
	if (!year || !month || !day) {
		return iso;
	}
	const thisYear = new Date().getFullYear();
	const date = `${day} ${MONTHS[month - 1]}${withYear || year !== thisYear ? ` ${year}` : ''}`;
	return iso.length > 10 ? `${date} ${iso.slice(11, 16)}` : date;
}

export function formatMonth(iso: string): string {
	const [year, month] = iso.split('-').map(Number);
	return month ? `${MONTHS[month - 1]} ${year}` : iso;
}

export function formatValue(field: Pick<FieldDef, 'type'>, value: Value | undefined): string {
	if (value === null || value === undefined || value === '') {
		return '';
	}
	if (typeof value === 'number') {
		return field.type === 'check' ? (value ? 'oui' : 'non') : formatNumber(value);
	}
	if (typeof value === 'boolean') {
		return value ? 'oui' : 'non';
	}
	if (typeof value === 'string') {
		return field.type === 'date' ? formatDate(value) : value;
	}
	return JSON.stringify(value);
}
