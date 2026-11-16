import { editText, formatValue } from '#lib/client/format.ts';
import type { FieldFormat } from '#lib/core/model.ts';
import { nowIso, todayIso } from '#lib/core/values.ts';

/** Ctrl+; puts in today, Ctrl+Shift+; the time as well, as in a spreadsheet. */
export function stampOf(event: KeyboardEvent): 'date' | 'time' | null {
	if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
	if (event.key === ';') return event.shiftKey ? 'time' : 'date';
	// AZERTY puts ; on the Comma key, where Shift types a period.
	const shifted = event.key === ':' || (event.key === '.' && event.code === 'Comma');
	return shifted && event.shiftKey ? 'time' : null;
}

export function stampText(field: FieldFormat | undefined, time: boolean): string | null {
	if (field === undefined) return null;
	if (field.type === 'date') return editText(field, todayIso());
	if (field.type === 'datetime') return editText(field, nowIso());
	if (field.type === 'text' || field.type === 'longtext') {
		return time
			? formatValue({ type: 'datetime' }, nowIso())
			: formatValue({ type: 'date' }, todayIso());
	}
	return null;
}

export function insertStamp(event: KeyboardEvent, field: FieldFormat): boolean {
	const kind = stampOf(event);
	const input = event.currentTarget;
	if (kind === null || !(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement))
		return false;
	const text = stampText(field, kind === 'time');
	if (text === null) return false;
	event.preventDefault();
	input.setRangeText(text, input.selectionStart ?? 0, input.selectionEnd ?? 0, 'end');
	input.dispatchEvent(new Event('input', { bubbles: true }));
	return true;
}
