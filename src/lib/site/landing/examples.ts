import type { DataColor } from '#lib/ui/colors.ts';

import type { PosterWords } from './posters.ts';

export type Cell = string | number;

export type ExampleField = {
	name: string;
	type: 'text' | 'number' | 'choice';
	choices?: { name: string; color: DataColor }[];
};

export type Prompt = { text: string } & (
	| { kind: 'formula'; name: string; expr: string; value: (row: Cell[]) => Cell }
	| { kind: 'rows'; rows: Cell[][] }
	| { kind: 'cell'; row: string; field: number; value: Cell }
	| { kind: 'chart'; name: string; group: number; value: number | null; label: string }
);

export type Example = {
	id: string;
	label: string;
	table: string;
	fields: ExampleField[];
	rows: Cell[][];
	prompts: Prompt[];
};

const n = (value: Cell): number => Number(value);

export const EXAMPLES: Example[] = [
	{
		id: 'budget',
		label: 'Budget',
		table: 'Budget',
		fields: [
			{ name: 'Item', type: 'text' },
			{ name: 'Amount', type: 'number' },
			{
				name: 'Category',
				type: 'choice',
				choices: [
					{ name: 'Home', color: 'violet' },
					{ name: 'Food', color: 'green' },
					{ name: 'Transport', color: 'blue' },
					{ name: 'Fun', color: 'pink' }
				]
			}
		],
		rows: [
			['Rent', 640, 'Home'],
			['Groceries', 210, 'Food'],
			['Train', 90, 'Transport'],
			['Dinner', 120, 'Food'],
			['Power', 110, 'Home'],
			['Books', 60, 'Fun']
		],
		prompts: [
			{
				text: 'Add what each one costs per year.',
				kind: 'formula',
				name: 'Per year',
				expr: '"Amount" * 12',
				value: (row) => n(row[1]) * 12
			},
			{
				text: 'Add Netflix 13 and climbing 45, both fun.',
				kind: 'rows',
				rows: [
					['Netflix', 13, 'Fun'],
					['Climbing', 45, 'Fun']
				]
			},
			{
				text: 'Show me where the money goes.',
				kind: 'chart',
				name: 'By category',
				group: 2,
				value: 1,
				label: 'Total amount'
			}
		]
	},
	{
		id: 'clients',
		label: 'Clients',
		table: 'Clients',
		fields: [
			{ name: 'Name', type: 'text' },
			{
				name: 'Stage',
				type: 'choice',
				choices: [
					{ name: 'Lead', color: 'amber' },
					{ name: 'Talking', color: 'blue' },
					{ name: 'Won', color: 'green' },
					{ name: 'Lost', color: 'gray' }
				]
			},
			{ name: 'Value', type: 'number' }
		],
		rows: [
			['Acme', 'Won', 12000],
			['Birch', 'Talking', 4000],
			['Cedar', 'Lead', 8000],
			['Delta', 'Talking', 20000],
			['Fern', 'Lead', 6000]
		],
		prompts: [
			{
				text: 'Add the expected value: won counts fully, talking half, a lead a fifth.',
				kind: 'formula',
				name: 'Expected',
				expr: `"Value" * CASE "Stage" WHEN 'Won' THEN 1 WHEN 'Talking' THEN 0.5 WHEN 'Lead' THEN 0.2 ELSE 0 END`,
				value: (row) => n(row[2]) * ({ Won: 1, Talking: 0.5, Lead: 0.2 }[String(row[1])] ?? 0)
			},
			{ text: 'Delta signed. Mark it won.', kind: 'cell', row: 'Delta', field: 1, value: 'Won' },
			{
				text: 'Chart the pipeline.',
				kind: 'chart',
				name: 'Pipeline',
				group: 1,
				value: 2,
				label: 'Total value'
			}
		]
	},
	{
		id: 'trip',
		label: 'Trip',
		table: 'Japan',
		fields: [
			{ name: 'Place', type: 'text' },
			{
				name: 'Kind',
				type: 'choice',
				choices: [
					{ name: 'Stay', color: 'violet' },
					{ name: 'Train', color: 'blue' },
					{ name: 'Food', color: 'green' },
					{ name: 'Visit', color: 'amber' }
				]
			},
			{ name: 'Cost', type: 'number' }
		],
		rows: [
			['Kyoto hotel', 'Stay', 420],
			['Shinkansen', 'Train', 130],
			['Ramen', 'Food', 40],
			['Fushimi', 'Visit', 20],
			['Ryokan', 'Stay', 280]
		],
		prompts: [
			{
				text: 'Add each cost split between the two of us.',
				kind: 'formula',
				name: 'Each',
				expr: '"Cost" / 2.0',
				value: (row) => n(row[2]) / 2
			},
			{ text: 'Add sushi in Osaka, 60.', kind: 'rows', rows: [['Sushi in Osaka', 'Food', 60]] },
			{
				text: 'Chart the cost by kind.',
				kind: 'chart',
				name: 'By kind',
				group: 1,
				value: 2,
				label: 'Total cost'
			}
		]
	},
	{
		id: 'reading',
		label: 'Reading',
		table: 'To read',
		fields: [
			{ name: 'Title', type: 'text' },
			{
				name: 'Status',
				type: 'choice',
				choices: [
					{ name: 'To read', color: 'gray' },
					{ name: 'Reading', color: 'amber' },
					{ name: 'Read', color: 'green' }
				]
			},
			{ name: 'Pages', type: 'number' }
		],
		rows: [
			['Dune', 'Read', 612],
			['Piranesi', 'Reading', 272],
			['Kindred', 'To read', 264],
			['Solaris', 'Read', 204],
			['Stoner', 'To read', 278]
		],
		prompts: [
			{
				text: 'Add how many hours each one takes at 40 pages an hour.',
				kind: 'formula',
				name: 'Hours',
				expr: '"Pages" / 40.0',
				value: (row) => n(row[2]) / 40
			},
			{ text: 'I finished Piranesi.', kind: 'cell', row: 'Piranesi', field: 1, value: 'Read' },
			{
				text: 'Chart the pages by status.',
				kind: 'chart',
				name: 'By status',
				group: 1,
				value: 2,
				label: 'Total pages'
			}
		]
	}
];

export const POSTER_WORDS: PosterWords = {
	weighIns: 'Weigh-ins',
	date: 'Date',
	kg: 'kg',
	trend: 'Trend',
	workouts: 'Workouts',
	exercise: 'Exercise',
	muscle: 'Muscle',
	reps: 'Reps',
	perWeek: 'Per week',
	lifts: [
		['Bench press', 0, 60],
		['Squat', 1, 80],
		['Deadlift', 2, 100],
		['Overhead press', 3, 40],
		['Pull-up', 2, 0],
		['Row', 2, 55]
	],
	muscles: [
		['Chest', 'pink'],
		['Legs', 'green'],
		['Back', 'blue'],
		['Shoulders', 'amber']
	],
	movies: 'Movies',
	title: 'Title',
	status: 'Status',
	watchedOn: 'Watched on',
	rating: 'Rating',
	byStatus: 'By status',
	statuses: [
		['To watch', 'gray'],
		['Watched', 'green'],
		['Dropped', 'orange']
	],
	films: [
		['The Zone of Interest', 0, null, null],
		['Aftersun', 0, null, null],
		['Parasite', 0, null, null],
		['Dune: Part Two', 1, 3, 5],
		['Perfect Days', 1, 12, 5],
		['Past Lives', 1, 26, 4],
		['Anatomy of a Fall', 1, 41, 4],
		['Spirited Away', 1, 64, 5],
		['Oppenheimer', 2, 50, 2]
	]
};
