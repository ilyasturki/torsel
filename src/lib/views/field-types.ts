import type { FieldType } from '#lib/core/model.ts';
import { fieldIcon } from '#lib/ui/field-icons.ts';
import type { Option } from '#lib/ui/Select.svelte';

/** Every type a person picks from, grouped by what the field holds. */
export const TYPE_GROUPS: { name: string; types: [FieldType, string][] }[] = [
	{
		name: 'Text',
		types: [
			['text', 'Text'],
			['longtext', 'Long text'],
			['url', 'URL'],
			['email', 'Email'],
			['phone', 'Phone']
		]
	},
	{
		name: 'Numbers',
		types: [
			['number', 'Number'],
			['currency', 'Currency'],
			['percent', 'Percent'],
			['rating', 'Rating'],
			['duration', 'Duration']
		]
	},
	{
		name: 'Dates',
		types: [
			['date', 'Date'],
			['datetime', 'Date and time']
		]
	},
	{
		name: 'Choices',
		types: [
			['choice', 'Choice'],
			['choices', 'Multiple choice'],
			['check', 'Checkbox']
		]
	},
	{
		name: 'Links and formulas',
		types: [
			['link', 'Link to a table'],
			['formula', 'Formula']
		]
	}
];

const LABELS = new Map(TYPE_GROUPS.flatMap((group) => group.types));

export function typeLabel(type: FieldType): string {
	return LABELS.get(type) ?? type;
}

export function typeOptions(keep: (type: FieldType) => boolean = () => true): Option<FieldType>[] {
	return TYPE_GROUPS.flatMap((group) =>
		group.types
			.filter(([type]) => keep(type))
			.map(([value, label]) => ({ value, label, icon: fieldIcon(value), group: group.name }))
	);
}

/** Types that ask for more than a name before they hold anything. */
export function needsSettings(type: FieldType): boolean {
	return type === 'choice' || type === 'choices' || type === 'link' || type === 'formula';
}
