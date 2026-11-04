import { describe, expect, it } from 'vitest';

import { entryPlan, nextLine, repeats } from './entry.ts';
import type { FieldDef, Rec } from './model.ts';

const field = (id: string): FieldDef => ({ id, name: id, type: 'choice' }) as FieldDef;
const session = field('session');
const exercise = field('exercise');

let at = 0;
function set(day: string, sessionName: string, exerciseName: string, reps: number | null): Rec {
	at += 1;
	return {
		id: `r${at}`,
		kind: 'row',
		base: 'b',
		parent: 't',
		data: { day, session: sessionName, exercise: exerciseName, reps },
		clocks: {}
	};
}

const plan = (rows: Rec[], value = 'push b') =>
	entryPlan(rows, {
		group: session,
		value,
		items: [exercise],
		dayOf: (row) => String(row.data.day),
		today: '2026-11-04',
		done: (row) => row.data.reps !== null
	});

const names = (rows: (Rec | null)[]) => rows.map((row) => row?.data.reps ?? null);

describe('entry plan', () => {
	const may = [
		set('2026-05-07', 'push b', 'bench', 6),
		set('2026-05-07', 'push b', 'bench', 7),
		set('2026-05-07', 'push b', 'dips', 8),
		set('2026-05-07', 'push b', 'dips', 9)
	];
	const older = set('2026-01-22', 'push b', 'bench', 1);
	const other = set('2026-10-29', 'push a', 'squat', 5);
	const planned = set('2026-11-20', 'push b', 'bench', null);

	it('repeats the last day before today with the same first key, grouped by the rest', () => {
		const out = plan([older, ...may, other, planned]);
		expect(out?.day).toBe('2026-05-07');
		expect(out?.groups.map((group) => group.row.data.exercise)).toEqual(['bench', 'dips']);
		expect(names(out?.groups[0].lines.map((line) => line.planned) ?? [])).toEqual([6, 7]);
		expect(nextLine(out)?.planned).toBe(may[0]);
	});

	it("fills the lines in turn with today's rows, the ones past the plan as lines of their own", () => {
		const today = [
			set('2026-11-04', 'push b', 'dips', 10),
			set('2026-11-04', 'push b', 'bench', 11),
			set('2026-11-04', 'push b', 'bench', 12),
			set('2026-11-04', 'push b', 'bench', 13),
			set('2026-11-04', 'push b', 'curl', 14)
		];
		const out = plan([...may, ...today]);
		const bench = out?.groups[0].lines ?? [];
		expect(names(bench.map((line) => line.logged))).toEqual([11, 12, 13]);
		expect(bench[2].planned).toBeNull();
		expect(out?.groups.map((group) => group.row.data.exercise)).toEqual(['bench', 'dips', 'curl']);
		expect(nextLine(out)?.planned).toBe(may[3]);
	});

	it('is none when the first key was never done before today', () => {
		expect(plan([...may, planned], 'legs a')).toBeNull();
		expect(plan([planned])).toBeNull();
	});
});

describe('repeated values', () => {
	const row = (data: Rec['data']): Rec => ({
		id: 'r',
		kind: 'row',
		base: 'b',
		parent: 't',
		data,
		clocks: {}
	});
	const title = { id: 'title', name: 'Title', type: 'text' } as FieldDef;

	it('copies words that come back and leaves a title to each row', () => {
		const titles = ['Dune', 'Parasite', 'Alien'].map((name) => row({ title: name }));
		const shops = ['Lidl', 'Lidl', 'Lidl', 'Monop', null].map((name) => row({ title: name }));
		expect(repeats(title, titles)).toBe(false);
		expect(repeats(title, shops)).toBe(true);
		expect(repeats(session, titles)).toBe(true);
	});
});
