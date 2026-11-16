import { describe, expect, it } from 'vitest';

import { defaultMatch } from './actions.ts';
import { entryPlan, nextLine, repeats } from './entry.ts';
import type { FieldDef, Rec, Value } from './model.ts';

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

	it('leaves each row its own images', () => {
		const poster = { id: 'poster', name: 'Poster', type: 'image' } as FieldDef;
		const posters = ['a', 'b', 'c'].map((id) => row({ poster: [{ id: id.repeat(64) }] }));
		expect(repeats(poster, posters)).toBe(false);
	});
});

describe('what "the last time" matches on by default', () => {
	const typed = (id: string, type: FieldDef['type'], choices = 0): FieldDef =>
		({
			id,
			name: id,
			type,
			choices: Array.from({ length: choices }, (_, at) => ({ name: `${id}${at}`, color: null }))
		}) as FieldDef;
	const gym = [
		typed('session', 'choice', 6),
		typed('date', 'date'),
		typed('exercise', 'choice', 56),
		typed('muscle', 'choice', 8),
		typed('reps', 'number')
	];
	const set = (date: string, name: string, lift: string, muscle: string): Rec => {
		const data: Record<string, Value> = { date, session: name, exercise: lift, muscle, reps: 8 };
		return { id: `${date}-${lift}`, data } as Rec;
	};

	it('reads a gym log as sessions of exercises', () => {
		const rows = [
			set('2026-10-29', 'push b', 'bench', 'chest'),
			set('2026-10-29', 'push b', 'dips', 'triceps'),
			set('2026-10-30', 'pull a', 'row', 'back'),
			set('2026-10-30', 'pull a', 'curl', 'biceps'),
			set('2026-10-31', 'legs a', 'squat', 'legs')
		];
		expect(defaultMatch(gym, rows)).toEqual(['session', 'exercise']);
	});

	it('keeps one key when the rows come one a day', () => {
		const rows = [
			set('2026-10-29', 'push b', 'bench', 'chest'),
			set('2026-10-30', 'pull a', 'row', 'back'),
			set('2026-10-31', 'legs a', 'squat', 'legs')
		];
		expect(defaultMatch(gym, rows)).toEqual(['exercise']);
	});

	it('keeps one key with no rows yet', () => {
		expect(defaultMatch(gym)).toEqual(['exercise']);
	});
});
