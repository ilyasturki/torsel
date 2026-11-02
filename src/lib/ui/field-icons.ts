import type { IconName } from './Icon.svelte';

const BY_TYPE: Record<string, IconName> = {
	text: 'text',
	longtext: 'long-text',
	number: 'number',
	currency: 'currency',
	percent: 'percent',
	rating: 'rating',
	date: 'date',
	datetime: 'date-time',
	duration: 'duration',
	choice: 'choice',
	choices: 'choices',
	check: 'checkbox',
	link: 'link',
	formula: 'formula',
	url: 'url',
	email: 'email',
	phone: 'phone'
};

export const FIELD_ICON_TYPES = Object.keys(BY_TYPE);

export function fieldIcon(type: string): IconName {
	return BY_TYPE[type] ?? 'text';
}
