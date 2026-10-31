import type { DataColor } from '#lib/ui/colors.ts';

export type Mark = {
	table: number;
	week: number;
	month: number;
	color: DataColor;
	alt: DataColor;
	group: string;
	text: () => string;
	detail: () => string;
};

export type Legend = [string, DataColor][];

export type Year = { marks: Mark[]; legends: Legend[] };

const CATEGORIES: [string, DataColor, number, number][] = [
	['Home', 'violet', 40, 800],
	['Food', 'green', 8, 70],
	['Transport', 'blue', 2, 40],
	['Fun', 'pink', 5, 60]
];
const STAGES: Legend = [
	['Lead', 'amber'],
	['Talking', 'blue'],
	['Won', 'green'],
	['Lost', 'gray']
];
const TASKS: Legend = [
	['To do', 'gray'],
	['Doing', 'blue'],
	['Done', 'green']
];
const JOBS: Legend = [
	['Applied', 'blue'],
	['Interview', 'amber'],
	['Offer', 'green'],
	['No', 'gray']
];
const KINDS: Legend = [
	['Stay', 'violet'],
	['Train', 'blue'],
	['Food', 'green'],
	['Visit', 'amber']
];
const BOOKS: Legend = [
	['To read', 'gray'],
	['Reading', 'amber'],
	['Read', 'green']
];

/** A sample year, one mark per row across six tables. Labels build on demand: thousands of date formats would block the page. */
export function sampleYear(): Year {
	let seed = 42;
	const rand = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
	const today = new Date();
	const format = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
	const day = (week: number): string => {
		const date = new Date(today);
		date.setDate(today.getDate() - (51 - week) * 7);
		return format.format(date);
	};
	const marks: Mark[] = [];
	const add = (
		table: number,
		week: number,
		color: DataColor,
		[group, alt]: [string, DataColor],
		name: string,
		text = group
	): void => {
		marks.push({
			table,
			week,
			month: Math.min(11, Math.floor((week / 52) * 12)),
			color,
			alt,
			group,
			text: () => text,
			detail: () => `${name}, ${day(week)}`
		});
	};

	for (let week = 0; week < 52; week++) {
		const season = 1 + Math.sin((week / 52) * Math.PI * 2 - 1) * 0.2;
		for (let i = 0, count = Math.round((7 + rand() * 7) * season); i < count; i++) {
			const [name, alt, low, range] = CATEGORIES[Math.floor(Math.pow(rand(), 0.8) * 4)];
			add(0, week, 'violet', [name, alt], 'Budget', `${name}, ${Math.round(low + rand() * range)}`);
		}
		for (let i = 0, count = Math.round(rand() * 2.4 * season); i < count; i++) {
			add(1, week, 'blue', STAGES[Math.floor(rand() * 4)], 'Clients');
		}
		const busy = week > 20 && week < 36 ? 1.6 : 1;
		for (let i = 0, count = Math.round((2 + rand() * 7) * busy); i < count; i++) {
			const status =
				week < 44 ? (rand() < 0.85 ? 2 : Math.floor(rand() * 2)) : Math.floor(rand() * 3);
			add(2, week, 'teal', TASKS[status], 'Projects');
		}
		if (week > 30) {
			for (let i = 0, count = Math.round(rand() * 3); i < count; i++) {
				add(3, week, 'amber', JOBS[Math.floor(Math.pow(rand(), 1.3) * 4)], 'Job search');
			}
		}
		if (week > 22 && week < 27) {
			for (let i = 0; i < 9; i++) add(4, week, 'pink', KINDS[Math.floor(rand() * 4)], 'Trip');
		}
		if (week % 2 === 0 || rand() < 0.2) {
			add(5, week, 'green', BOOKS[week < 40 ? 2 : week < 47 ? 1 : 0], 'Reading');
		}
	}

	return {
		marks,
		legends: [CATEGORIES.map(([name, color]) => [name, color]), STAGES, TASKS, JOBS, KINDS, BOOKS]
	};
}
