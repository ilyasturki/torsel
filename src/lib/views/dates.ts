import type { FieldFormat, Value } from '#lib/core/model.ts';

/** A day picked on the calendar; a date and time keeps the time it had. */
export function dayPicked(field: FieldFormat, value: Value | undefined, day: string): string {
	const time = typeof value === 'string' ? /T\d{2}:\d{2}/u.exec(value)?.[0] : undefined;
	return field.type === 'datetime' && time !== undefined ? `${day}${time}` : day;
}

const DURATION_STEP = 300;

export function durationStep(value: Value | undefined, direction: 1 | -1): number {
	const base = typeof value === 'number' ? value : 0;
	return Math.max(0, base + direction * DURATION_STEP);
}
