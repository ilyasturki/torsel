import type { DataColor } from '#lib/ui/colors.ts';

export type Cell = string | number;

export type ExampleField = {
	name: string;
	type: 'text' | 'number' | 'choice';
	choices?: { name: string; color: DataColor }[];
};

export type ViewStep = { sentence: string; name: string } & (
	| { view: 'entry' }
	| { view: 'list'; group: number }
	| { view: 'chart'; group: number; value: number | null; unit: string }
);

export type Example = {
	id: string;
	label: string;
	table: string;
	sentence: string;
	fields: ExampleField[];
	rows: Cell[][];
	column: {
		sentence: string;
		name: string;
		expr: string;
		value: (row: Cell[]) => Cell;
	};
	first: ViewStep;
	second: ViewStep;
};

const n = (value: Cell): number => Number(value);

export const EXAMPLES: Example[] = [
	{
		id: 'budget',
		label: 'Budget',
		table: 'Budget',
		sentence:
			'Make me a budget: item, amount, category. Rent 640, groceries 210, train 90, dinner 120, power 110, books 60.',
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
		column: {
			sentence: 'Add what each one costs per year.',
			name: 'Per year',
			expr: '"Amount" * 12',
			value: (row) => n(row[1]) * 12
		},
		first: { sentence: 'Give me a form to add one from my phone.', name: 'Add one', view: 'entry' },
		second: {
			sentence: 'Show me where the money goes.',
			name: 'By category',
			view: 'chart',
			group: 2,
			value: 1,
			unit: 'Sum of Amount, by Category'
		}
	},
	{
		id: 'clients',
		label: 'Clients',
		table: 'Clients',
		sentence:
			'Keep my clients: name, stage, value. Acme won 12000, Birch talking 4000, Cedar lead 8000, Delta talking 20000, Fern lead 6000.',
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
		column: {
			sentence: 'Add the expected value: won counts fully, talking half, a lead a fifth.',
			name: 'Expected',
			expr: `"Value" * CASE "Stage" WHEN 'Won' THEN 1 WHEN 'Talking' THEN 0.5 WHEN 'Lead' THEN 0.2 ELSE 0 END`,
			value: (row) => n(row[2]) * ({ Won: 1, Talking: 0.5, Lead: 0.2 }[String(row[1])] ?? 0)
		},
		first: { sentence: 'Show them as cards by stage.', name: 'By stage', view: 'list', group: 1 },
		second: {
			sentence: 'Chart the pipeline.',
			name: 'Pipeline',
			view: 'chart',
			group: 1,
			value: 2,
			unit: 'Sum of Value, by Stage'
		}
	},
	{
		id: 'projects',
		label: 'Projects',
		table: 'Launch',
		sentence:
			'Track the launch: task, owner, status. Copy Ana doing, logo Sam done, pricing Ana to do, press kit Lea to do, video Sam doing.',
		fields: [
			{ name: 'Task', type: 'text' },
			{ name: 'Owner', type: 'text' },
			{
				name: 'Status',
				type: 'choice',
				choices: [
					{ name: 'To do', color: 'gray' },
					{ name: 'Doing', color: 'blue' },
					{ name: 'Done', color: 'green' }
				]
			}
		],
		rows: [
			['Copy', 'Ana', 'Doing'],
			['Logo', 'Sam', 'Done'],
			['Pricing', 'Ana', 'To do'],
			['Press kit', 'Lea', 'To do'],
			['Video', 'Sam', 'Doing']
		],
		column: {
			sentence: 'Add a column that says who to chase: anything not done.',
			name: 'Chase',
			expr: `CASE WHEN "Status" = 'Done' THEN '' ELSE "Owner" END`,
			value: (row) => (row[2] === 'Done' ? '' : row[1])
		},
		first: { sentence: 'Group the tasks by status.', name: 'By status', view: 'list', group: 2 },
		second: {
			sentence: 'How many does each person have?',
			name: 'By owner',
			view: 'chart',
			group: 1,
			value: null,
			unit: 'Number of tasks, by Owner'
		}
	},
	{
		id: 'jobs',
		label: 'Job search',
		table: 'Applications',
		sentence:
			'Log my applications: company, role, status. Northwind designer applied, Lumen PM interview, Orbit designer offer, Vega PM no.',
		fields: [
			{ name: 'Company', type: 'text' },
			{ name: 'Role', type: 'text' },
			{
				name: 'Status',
				type: 'choice',
				choices: [
					{ name: 'Applied', color: 'blue' },
					{ name: 'Interview', color: 'amber' },
					{ name: 'Offer', color: 'green' },
					{ name: 'No', color: 'gray' }
				]
			}
		],
		rows: [
			['Northwind', 'Designer', 'Applied'],
			['Lumen', 'PM', 'Interview'],
			['Orbit', 'Designer', 'Offer'],
			['Vega', 'PM', 'No']
		],
		column: {
			sentence: 'Add what my next step is for each one.',
			name: 'Next step',
			expr: `CASE "Status" WHEN 'Applied' THEN 'Follow up' WHEN 'Interview' THEN 'Prepare' WHEN 'Offer' THEN 'Decide' ELSE '' END`,
			value: (row) =>
				({ Applied: 'Follow up', Interview: 'Prepare', Offer: 'Decide' })[String(row[2])] ?? ''
		},
		first: { sentence: 'Group them by status.', name: 'By status', view: 'list', group: 2 },
		second: {
			sentence: 'Chart where each one stands.',
			name: 'Funnel',
			view: 'chart',
			group: 2,
			value: null,
			unit: 'Number of applications, by Status'
		}
	},
	{
		id: 'trip',
		label: 'Trip',
		table: 'Japan',
		sentence:
			'Plan my trip to Japan: place, kind, cost. Kyoto hotel stay 420, Shinkansen train 130, ramen food 40, Fushimi visit 20, ryokan stay 280.',
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
		column: {
			sentence: 'Add each cost split between the two of us.',
			name: 'Each',
			expr: '"Cost" / 2.0',
			value: (row) => n(row[2]) / 2
		},
		first: {
			sentence: 'Give me a form to add things on the go.',
			name: 'Add one',
			view: 'entry'
		},
		second: {
			sentence: 'What is it costing, by kind?',
			name: 'By kind',
			view: 'chart',
			group: 1,
			value: 2,
			unit: 'Sum of Cost, by Kind'
		}
	},
	{
		id: 'reading',
		label: 'Reading',
		table: 'To read',
		sentence:
			'Things to read: title, status, pages. Dune read 612, Piranesi reading 272, Kindred to read 264, Solaris read 204, Stoner to read 278.',
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
		column: {
			sentence: 'Add how many hours each one takes at 40 pages an hour.',
			name: 'Hours',
			expr: '"Pages" / 40.0',
			value: (row) => n(row[2]) / 40
		},
		first: { sentence: 'Show them as cards by status.', name: 'By status', view: 'list', group: 1 },
		second: {
			sentence: 'How many pages are in each pile?',
			name: 'By status',
			view: 'chart',
			group: 1,
			value: 2,
			unit: 'Sum of Pages, by Status'
		}
	}
];

export function sentences(example: Example): string[] {
	return [
		example.sentence,
		example.column.sentence,
		example.first.sentence,
		example.second.sentence
	];
}

export function colorOf(example: Example, value: Cell): DataColor {
	for (const field of example.fields) {
		const found = field.choices?.find((choice) => choice.name === value);
		if (found !== undefined) return found.color;
	}
	return 'gray';
}

export function choiceIndex(example: Example): number {
	return example.fields.findIndex((field) => field.type === 'choice');
}

export function numberIndex(example: Example): number {
	return example.fields.findIndex((field) => field.type === 'number');
}
