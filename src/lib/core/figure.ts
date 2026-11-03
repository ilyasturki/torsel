import { chartSetup } from './actions.ts';
import type { ChartData } from './chart.ts';
import { headline } from './chart.ts';
import type { ChartConfig } from './model.ts';
import { pad } from './values.ts';
import type { Workspace } from './workspace.ts';
import { createdAt } from './workspace.ts';

export type Figure =
	| {
			kind: 'chart';
			value: number;
			/** The x the value stands at, empty for a grand total. */
			at: string;
			label: string;
			config: ChartConfig;
			byDate: boolean;
			trend: number[];
	  }
	| { kind: 'check'; label: string; done: number; total: number };

const TREND = 24;

function trend(data: ChartData, config: ChartConfig): number[] {
	const series = data.points.at(-1)?.series;
	const totals = new Map<string, number>();
	for (const point of data.points) {
		if (config.kind === 'line' && point.series !== series) continue;
		totals.set(point.x, (totals.get(point.x) ?? 0) + point.y);
	}
	return [...totals.values()].slice(-TREND);
}

/** A table's figure on the home: its first chart view's headline and line, else what its check field has ticked. */
export function tableFigure(
	ws: Workspace,
	tableId: string,
	chart: (config: ChartConfig) => ChartData | null
): Figure | null {
	const rows = ws.rows(tableId);
	if (rows.length === 0) {
		return null;
	}

	const fields = ws.fields(tableId);
	for (const view of ws.views(tableId)) {
		if (view.type !== 'chart') continue;
		const config = chartSetup(fields, view.config);
		const data = chart(config);
		const byDate = ws.field(config.x ?? '')?.type === 'date';
		const lead = data === null ? null : headline(data, config, byDate);
		if (data === null || lead === null) continue;
		return {
			kind: 'chart',
			value: lead.y,
			at: lead.x,
			label: data.yLabel,
			config,
			byDate,
			trend: trend(data, config)
		};
	}

	const check = fields.find((field) => field.type === 'check');
	return check === undefined
		? null
		: {
				kind: 'check',
				label: check.name,
				done: rows.filter((row) => row.data[check.id] === true).length,
				total: rows.length
			};
}

/** The newest day a table holds: the latest value of its first date field, else the day its newest row was added. */
export function lastEntry(ws: Workspace, tableId: string): string | null {
	const rows = ws.rows(tableId);
	const date = ws.fields(tableId).find((field) => field.type === 'date');
	let latest: string | null = null;
	if (date !== undefined) {
		for (const row of rows) {
			const value = row.data[date.id];
			if (typeof value === 'string' && (latest === null || value > latest)) latest = value;
		}
	}
	if (latest !== null) {
		return latest.slice(0, 10);
	}

	const newest = rows.at(-1);
	if (newest === undefined || createdAt(newest) === 0) {
		return null;
	}
	const day = new Date(createdAt(newest));
	return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}
