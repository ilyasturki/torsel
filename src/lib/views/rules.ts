import { formatValue } from '#lib/client/format.ts';
import type { Condition, FormulaHits } from '#lib/core/conditions.ts';
import { RELATIVE_DAYS } from '#lib/core/conditions.ts';
import type { Phrase } from '#lib/core/diff.ts';
import { namesIn, toDisplay } from '#lib/core/formula.ts';
import type { FieldDef } from '#lib/core/model.ts';
import { isDated } from '#lib/core/model.ts';
import type { Workspace } from '#lib/core/workspace.ts';
import { rules as words } from '#lib/i18n/rules.ts';

function dayText(value: string): string {
	return (RELATIVE_DAYS as readonly string[]).includes(value)
		? words.days[value as (typeof RELATIVE_DAYS)[number]]
		: value;
}

export function phraseText(phrase: Phrase): string {
	if (phrase.op === 'formula') return phrase.value[0] ?? '';
	const typed = ['contains', 'not-contains', 'starts', 'ends'].includes(phrase.op);
	const values = phrase.value.map((value) => (typed ? words.quoted(value) : dayText(value)));
	const value =
		phrase.op === 'between' || phrase.op === 'not-between'
			? words.either(values[0] ?? '', values[1] ?? '')
			: values.join(', ');
	return words.condition(phrase.field, words.ops[phrase.op], value);
}

function valueText(ws: Workspace, field: FieldDef | undefined, value: unknown): string {
	if (typeof value !== 'string' && typeof value !== 'number') return String(value);
	if (field === undefined) return String(value);
	if (field.type === 'link') return ws.rowTitle(String(value));
	if (isDated(field.type) || (field.type === 'formula' && field.result === 'date')) {
		return (RELATIVE_DAYS as readonly string[]).includes(String(value))
			? String(value)
			: formatValue({ type: 'date' }, String(value));
	}
	return typeof value === 'number' ? formatValue(field, value) : value;
}

export function phraseOf(ws: Workspace, tableId: string, condition: Condition): Phrase {
	if (condition.op === 'formula') {
		const base = ws.table(tableId)?.base ?? '';
		return {
			field: '',
			op: 'formula',
			value: [toDisplay(String(condition.value ?? ''), namesIn(ws, base))]
		};
	}
	const field = condition.field === null ? undefined : ws.field(condition.field);
	const values =
		condition.value === undefined
			? []
			: Array.isArray(condition.value)
				? condition.value
				: [condition.value];
	return {
		field: field?.name ?? '',
		op: condition.op,
		value: values.map((value) => valueText(ws, field, value))
	};
}

export function conditionText(ws: Workspace, tableId: string, condition: Condition): string {
	return phraseText(phraseOf(ws, tableId, condition));
}

/** A custom formula's value per row, worked out once per stored formula. */
export function formulaHits(read: (stored: string) => Map<string, unknown>): FormulaHits {
	const known = new Map<string, Map<string, unknown>>();
	return (stored) => {
		let values = known.get(stored);
		if (values === undefined) {
			values = read(stored);
			known.set(stored, values);
		}
		return values;
	};
}
