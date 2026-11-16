import type { FieldDef, Rec, Value } from './model.ts';

export type PlanLine = { planned: Rec | null; logged: Rec | null };

export type PlanGroup = { key: string; row: Rec; lines: PlanLine[] };

export type Plan = { day: string; groups: PlanGroup[] };

export function sameValue(a: Value | undefined, b: Value | undefined): boolean {
	return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export const blank = (value: Value | undefined): boolean =>
	value === null || value === undefined || value === '';

const WORDS = new Set(['text', 'longtext', 'url', 'email', 'phone', 'image']);

/** Whether a field's past values are worth copying into the next row: a title or a note, unique to each row, is not. */
export function repeats(field: FieldDef, rows: Rec[]): boolean {
	if (!WORDS.has(field.type)) {
		return true;
	}
	const values = rows.map((row) => row.data[field.id]).filter((value) => !blank(value));
	return new Set(values.map((value) => JSON.stringify(value))).size * 2 <= values.length;
}

/** Today's rows pair in turn with the last earlier day's rows of the same `items`; the extra ones get lines of their own. */
export function entryPlan(
	rows: Rec[],
	options: {
		group: FieldDef;
		value: Value;
		items: FieldDef[];
		dayOf: (row: Rec) => string;
		today: string;
		done: (row: Rec) => boolean;
	}
): Plan | null {
	const { group, value, items, dayOf, today, done } = options;
	const mine = rows.filter((row) => sameValue(row.data[group.id], value));
	const past = mine.filter((row) => done(row) && dayOf(row) < today);
	const day = past.reduce((latest, row) => (dayOf(row) > latest ? dayOf(row) : latest), '');
	if (day === '') {
		return null;
	}

	const groups = new Map<string, PlanGroup>();
	const groupOf = (row: Rec): PlanGroup => {
		const key = JSON.stringify(items.map((field) => row.data[field.id] ?? null));
		let found = groups.get(key);
		if (found === undefined) {
			found = { key, row, lines: [] };
			groups.set(key, found);
		}
		return found;
	};

	for (const row of past.filter((candidate) => dayOf(candidate) === day)) {
		groupOf(row).lines.push({ planned: row, logged: null });
	}
	for (const row of mine.filter((candidate) => dayOf(candidate) === today)) {
		const { lines } = groupOf(row);
		const open = lines.find((line) => line.planned !== null && line.logged === null);
		if (open === undefined) {
			lines.push({ planned: null, logged: row });
		} else {
			open.logged = row;
		}
	}

	return { day, groups: [...groups.values()] };
}

export function nextLine(plan: Plan | null): PlanLine | undefined {
	return plan?.groups
		.flatMap((group) => group.lines)
		.find((line) => line.planned !== null && line.logged === null);
}
