import type { FieldType } from '#lib/core/model.ts';
import { fields as words } from '#lib/i18n/fields.ts';
import { fieldIcon } from '#lib/ui/field-icons.ts';
import type { Option } from '#lib/ui/Select.svelte';

const TYPE_GROUPS: { group: keyof typeof words.groups; types: FieldType[] }[] = [
	{ group: 'text', types: ['text', 'longtext', 'url', 'email', 'phone'] },
	{ group: 'numbers', types: ['number', 'currency', 'percent', 'rating', 'duration'] },
	{ group: 'dates', types: ['date', 'datetime'] },
	{ group: 'choices', types: ['choice', 'choices', 'check'] },
	{ group: 'links', types: ['link', 'formula'] }
];

export function typeLabel(type: FieldType): string {
	return words.types[type];
}

export function typeOptions(keep: (type: FieldType) => boolean = () => true): Option<FieldType>[] {
	return TYPE_GROUPS.flatMap(({ group, types }) =>
		types.filter(keep).map((value) => ({
			value,
			label: typeLabel(value),
			icon: fieldIcon(value),
			group: words.groups[group]
		}))
	);
}

/** Types that ask for more than a name before they hold anything. */
export function needsSettings(type: FieldType): boolean {
	return type === 'choice' || type === 'choices' || type === 'link' || type === 'formula';
}
