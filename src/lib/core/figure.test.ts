import { describe, expect, it } from 'vitest';

import { createBase, createTable, createView, insertRows, type FieldSpec } from './actions.ts';
import { chartData } from './chart.ts';
import { Hlc } from './clock.ts';
import { openEngine } from './engine.ts';
import { lastEntry, tableFigure } from './figure.ts';
import type { Change } from './model.ts';
import { materializeTable } from './sql.ts';
import { Workspace } from './workspace.ts';

function workspace(): { ws: Workspace; apply: (changes: Change[]) => void; base: string } {
	const ws = new Workspace();
	const hlc = new Hlc('a');
	const apply = (changes: Change[]): void => {
		for (const change of changes) ws.stamp(change, hlc.tick());
	};
	const base = createBase(ws, 'Poids');
	apply(base.changes);
	return { ws, apply, base: base.id };
}

function table(
	{ ws, apply, base }: ReturnType<typeof workspace>,
	name: string,
	fields: FieldSpec[],
	rows: unknown[][]
): { id: string; fieldIds: string[] } {
	const made = createTable(ws, base, name, fields);
	apply(made.changes);
	apply(
		insertRows(
			ws,
			made.id,
			rows.map((row) => Object.fromEntries(row.map((value, at) => [made.fieldIds[at], value])))
		).changes
	);
	return made;
}

async function figureOf(ws: Workspace, tableId: string): Promise<ReturnType<typeof tableFigure>> {
	const engine = await openEngine();
	materializeTable(engine, ws, tableId);
	return tableFigure(ws, tableId, (config) => chartData(engine, ws, tableId, config));
}

describe('table figure', () => {
	it('leads with the first chart view, as its chart does', async () => {
		const at = workspace();
		const weighIns = table(
			at,
			'Pesées',
			[
				{ name: 'Date', type: 'date' },
				{ name: 'kg', type: 'number' }
			],
			[
				['2026-10-25', 88.4],
				['2026-10-26', 88.1],
				['2026-10-27', 87.9],
				['2026-10-28', 88]
			]
		);
		const [date, kg] = weighIns.fieldIds;
		at.apply(
			createView(at.ws, weighIns.id, {
				name: 'Courbe',
				type: 'chart',
				config: { kind: 'line', x: date, agg: 'avg', y: kg, rolling: 7 }
			}).changes
		);

		const figure = await figureOf(at.ws, weighIns.id);
		expect(figure).toMatchObject({ kind: 'chart', at: '2026-10-28', label: 'Average kg' });
		expect(figure?.kind === 'chart' && figure.value).toBeCloseTo(88.1);
		expect(figure?.kind === 'chart' && figure.trend.map((value) => value.toFixed(2))).toEqual([
			'88.40',
			'88.25',
			'88.13',
			'88.10'
		]);
		expect(lastEntry(at.ws, weighIns.id)).toBe('2026-10-28');
	});

	it('reads a date and time like a date', async () => {
		const at = workspace();
		const sleep = table(
			at,
			'Sommeil',
			[
				{ name: 'Night', type: 'datetime' },
				{ name: 'Slept', type: 'duration' }
			],
			[
				['2026-10-27T23:10', 25200],
				['2026-10-28T23:40', 27000]
			]
		);
		const [night, slept] = sleep.fieldIds;
		at.apply(
			createView(at.ws, sleep.id, {
				name: 'Nights',
				type: 'chart',
				config: { kind: 'line', x: night, agg: 'avg', y: slept }
			}).changes
		);

		expect(await figureOf(at.ws, sleep.id)).toMatchObject({
			kind: 'chart',
			byDate: true,
			at: '2026-10-28',
			value: 27000
		});
		expect(lastEntry(at.ws, sleep.id)).toBe('2026-10-28');
	});

	it('totals bars over something other than time, stacked series included', async () => {
		const at = workspace();
		const sets = table(
			at,
			'Séries',
			[
				{ name: 'Exercise', type: 'text' },
				{ name: 'Session', type: 'text' },
				{ name: 'Volume', type: 'number' }
			],
			[
				['Squat', 'legs', 500],
				['Bench', 'push', 300],
				['Bench', 'legs', 200]
			]
		);
		const [exercise, session, volume] = sets.fieldIds;
		at.apply(
			createView(at.ws, sets.id, {
				name: 'Volume',
				type: 'chart',
				config: { x: exercise, agg: 'sum', y: volume, color: session }
			}).changes
		);

		const figure = await figureOf(at.ws, sets.id);
		expect(figure).toMatchObject({ kind: 'chart', value: 1000, at: '', trend: [500, 500] });
	});

	it('falls back to what a check field has ticked', async () => {
		const at = workspace();
		const list = table(
			at,
			'Liste',
			[
				{ name: 'Article', type: 'text' },
				{ name: 'Acheté', type: 'check' }
			],
			[
				['Pommes', false],
				['Lait', true],
				['Pâtes', true]
			]
		);

		expect(await figureOf(at.ws, list.id)).toEqual({
			kind: 'check',
			label: 'Acheté',
			done: 2,
			total: 3
		});
	});

	it('has none for a table with only text, or with no rows', async () => {
		const at = workspace();
		const shops = table(at, 'Magasins', [{ name: 'Nom', type: 'text' }], [['Biocoop']]);
		const empty = table(at, 'Table 1', [{ name: 'Done', type: 'check' }], []);

		expect(await figureOf(at.ws, shops.id)).toBeNull();
		expect(await figureOf(at.ws, empty.id)).toBeNull();
		expect(lastEntry(at.ws, empty.id)).toBeNull();
		expect(lastEntry(at.ws, shops.id)).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
	});
});
