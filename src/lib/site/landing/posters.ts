import type { DataColor } from '#lib/ui/colors.ts';

import type { Cell } from './examples.ts';

export type PosterField = {
	name: string;
	type: 'text' | 'number' | 'choice' | 'date' | 'rating';
	choices?: { name: string; color: DataColor }[];
	decimals?: number;
};

export type PosterView =
	| {
			name: string;
			type: 'chart';
			kind: 'bar' | 'line';
			x: number;
			bucket?: 'week';
			agg: 'sum' | 'avg';
			y: number;
			color?: number;
			rolling?: number;
	  }
	| { name: string; type: 'list'; group: number; title: number; show: number[] };

export type PosterId = 'weight' | 'lifting' | 'movies';

export type Poster = {
	id: PosterId;
	table: string;
	fields: PosterField[];
	rows: (Cell | null)[][];
	view: PosterView;
};

export type PosterWords = {
	weighIns: string;
	date: string;
	kg: string;
	trend: string;
	workouts: string;
	exercise: string;
	muscle: string;
	reps: string;
	perWeek: string;
	// Name, index into `muscles`, starting kg.
	lifts: [string, number, number][];
	muscles: [string, DataColor][];
	movies: string;
	title: string;
	status: string;
	watchedOn: string;
	rating: string;
	byStatus: string;
	statuses: [string, DataColor][];
	// Title, index into `statuses`, days ago watched, stars.
	films: [string, number, number | null, number | null][];
};

function day(today: Date, back: number): string {
	const at = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back, 12);
	const month = String(at.getMonth() + 1).padStart(2, '0');
	return `${at.getFullYear()}-${month}-${String(at.getDate()).padStart(2, '0')}`;
}

// Fixed noise, so the posters draw the same on every load and in tests.
function noise(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state * 16807) % 2147483647;
		return (state - 1) / 2147483646;
	};
}

/** Three tables a person keeps, dated back from `today`: weigh-ins, sets at the gym, movies. */
export function posters(today: Date, words: PosterWords): Poster[] {
	const next = noise(7);
	const weighIns: (Cell | null)[][] = [];
	for (let back = 89; back >= 0; back -= 1) {
		if (next() < 0.12) continue;
		const kg = 84.6 - (89 - back) * 0.035 + (next() - 0.5) * 1.1;
		weighIns.push([day(today, back), Math.round(kg * 10) / 10]);
	}
	const sets: (Cell | null)[][] = [];
	for (let week = 9; week >= 0; week -= 1) {
		for (const offset of [5, 3, 1]) {
			const picks = [words.lifts[(week + offset) % 6], words.lifts[(week + offset + 2) % 6]];
			for (const [exercise, muscle, start] of picks) {
				for (let set = 0; set < 3; set += 1) {
					const kg = start === 0 ? 0 : start + (9 - week) * 1.25;
					const reps = 5 + Math.floor(next() * 5);
					sets.push([day(today, week * 7 + offset), exercise, words.muscles[muscle][0], reps, kg]);
				}
			}
		}
	}
	return [
		{
			id: 'weight',
			table: words.weighIns,
			fields: [
				{ name: words.date, type: 'date' },
				{ name: words.kg, type: 'number', decimals: 1 }
			],
			rows: weighIns,
			view: { name: words.trend, type: 'chart', kind: 'line', x: 0, agg: 'avg', y: 1, rolling: 7 }
		},
		{
			id: 'lifting',
			table: words.workouts,
			fields: [
				{ name: words.date, type: 'date' },
				{
					name: words.exercise,
					type: 'choice',
					choices: words.lifts.map(([name]) => ({ name, color: 'gray' }))
				},
				{
					name: words.muscle,
					type: 'choice',
					choices: words.muscles.map(([name, color]) => ({ name, color }))
				},
				{ name: words.reps, type: 'number' },
				{ name: words.kg, type: 'number', decimals: 1 }
			],
			rows: sets,
			view: {
				name: words.perWeek,
				type: 'chart',
				kind: 'bar',
				x: 0,
				bucket: 'week',
				agg: 'sum',
				y: 4,
				color: 2
			}
		},
		{
			id: 'movies',
			table: words.movies,
			fields: [
				{ name: words.title, type: 'text' },
				{
					name: words.status,
					type: 'choice',
					choices: words.statuses.map(([name, color]) => ({ name, color }))
				},
				{ name: words.watchedOn, type: 'date' },
				{ name: words.rating, type: 'rating' }
			],
			rows: words.films.map(([title, status, back, stars]) => [
				title,
				words.statuses[status][0],
				back === null ? null : day(today, back),
				stars
			]),
			view: { name: words.byStatus, type: 'list', group: 1, title: 0, show: [3, 2] }
		}
	];
}
