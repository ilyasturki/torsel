import type { Choice } from '../core/model.ts';

export const DATA_COLORS = [
	'gray',
	'orange',
	'amber',
	'green',
	'teal',
	'blue',
	'violet',
	'pink'
] as const;

export type DataColor = (typeof DATA_COLORS)[number];

export function isDataColor(value: unknown): value is DataColor {
	return typeof value === 'string' && (DATA_COLORS as readonly string[]).includes(value);
}

export function nextChoice(choices: Choice[], name: string): Choice {
	return { name, color: DATA_COLORS[(choices.length % 7) + 1] };
}

export function swatch(color: string | null | undefined): string {
	return `background: var(--d-${isDataColor(color) ? color : 'gray'})`;
}

export function strongColor(color: string | null | undefined, index: number): string {
	const name = isDataColor(color) ? color : DATA_COLORS[(index % (DATA_COLORS.length - 1)) + 1];
	return `var(--d-${name})`;
}
