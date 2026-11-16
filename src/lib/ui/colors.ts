import type { Choice } from '../core/model.ts';

export const DATA_COLORS = [
	'gray',
	'orange',
	'amber',
	'green',
	'teal',
	'blue',
	'violet',
	'pink',
	'red'
] as const;

// Gray and red are left out: a new choice or a chart series never reads as a warning.
const AUTO_COLORS = DATA_COLORS.slice(1, -1);

export type DataColor = (typeof DATA_COLORS)[number];

export function isDataColor(value: unknown): value is DataColor {
	return typeof value === 'string' && (DATA_COLORS as readonly string[]).includes(value);
}

export function nextChoice(choices: Choice[], name: string): Choice {
	return { name, color: AUTO_COLORS[choices.length % AUTO_COLORS.length] };
}

export function swatch(color: string | null | undefined): string {
	return `background: var(--d-${isDataColor(color) ? color : 'gray'})`;
}

export function tag(color: string | null | undefined): string {
	const name = isDataColor(color) ? color : 'gray';
	return `background: var(--d-${name}-bg); color: var(--d-${name}-fg)`;
}

export function strongColor(color: string | null | undefined, index: number): string {
	const name = isDataColor(color) ? color : AUTO_COLORS[index % AUTO_COLORS.length];
	return `var(--d-${name})`;
}
