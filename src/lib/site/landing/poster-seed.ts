import { createTable, insertRows } from '#lib/core/actions.ts';
import type { ChartData } from '#lib/core/chart.ts';
import type { Change, ViewConfig } from '#lib/core/model.ts';
import type { Workspace } from '#lib/core/workspace.ts';

import type { Poster, PosterId, PosterView } from './posters.ts';

export type Placed = { table: string; fields: string[]; view: string };

function configOf(view: PosterView, fields: string[]): ViewConfig {
	if (view.type === 'list') {
		return {
			group: fields[view.group],
			title: fields[view.title],
			show: view.show.map((at) => fields[at])
		};
	}
	return {
		kind: view.kind,
		x: fields[view.x],
		...(view.bucket === undefined ? {} : { bucket: view.bucket }),
		agg: view.agg,
		y: fields[view.y],
		...(view.color === undefined ? {} : { color: fields[view.color] }),
		...(view.rolling === undefined ? {} : { rolling: view.rolling })
	};
}

/** Each poster as a table in `baseId`, opening on its one view. */
export function seedPosters(
	ws: Workspace,
	commit: (changes: Change[]) => void,
	baseId: string,
	list: Poster[]
): Record<PosterId, Placed> {
	const placed = {} as Record<PosterId, Placed>;
	for (const poster of list) {
		const made = createTable(ws, baseId, poster.table, poster.fields, (fields) => [
			{
				name: poster.view.name,
				type: poster.view.type,
				config: configOf(
					poster.view,
					fields.map((field) => field.id)
				)
			}
		]);
		commit(made.changes);
		const rows = poster.rows.map((row) =>
			Object.fromEntries(
				made.fieldIds.flatMap((id, at) => (row[at] === null ? [] : [[id, row[at]]]))
			)
		);
		commit(insertRows(ws, made.id, rows).changes);
		placed[poster.id] = { table: made.id, fields: made.fieldIds, view: made.viewIds[0] };
	}
	return placed;
}

function julian(day: string): number {
	const [year, month, date] = day.split('-').map(Number);
	return Date.UTC(year, month - 1, date) / 86_400_000;
}

function monday(day: string): string {
	const at = new Date(julian(day) * 86_400_000);
	at.setUTCDate(at.getUTCDate() - ((at.getUTCDay() + 6) % 7));
	return at.toISOString().slice(0, 10);
}

const order = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** What the chart's SQL returns for this poster, worked out from its rows so it draws before SQLite loads. */
export function earlyChart(poster: Poster): ChartData | null {
	const view = poster.view;
	if (view.type !== 'chart') return null;
	const groups = new Map<string, { x: string; series: string; values: number[] }>();
	for (const row of poster.rows) {
		const day = row[view.x];
		const y = row[view.y];
		if (typeof day !== 'string' || typeof y !== 'number') continue;
		const x = view.bucket === 'week' ? monday(day) : day;
		const series = view.color === undefined ? '' : String(row[view.color] ?? '');
		const key = JSON.stringify([x, series]);
		const group = groups.get(key) ?? { x, series, values: [] };
		group.values.push(y);
		groups.set(key, group);
	}
	const total = (values: number[]): number => values.reduce((sum, value) => sum + value, 0);
	let points = [...groups.values()]
		.map(({ x, series, values }) => ({
			x,
			series,
			y: view.agg === 'sum' ? total(values) : total(values) / values.length
		}))
		.sort((a, b) => order(a.x, b.x) || order(a.series, b.series));
	const rolling = view.rolling ?? 1;
	if (view.kind === 'line' && rolling > 1) {
		const grouped = points;
		points = grouped.map((point) => {
			const inside = grouped.filter(
				(other) =>
					other.series === point.series &&
					julian(other.x) <= julian(point.x) &&
					julian(other.x) >= julian(point.x) - (rolling - 1)
			);
			return { ...point, y: total(inside.map((other) => other.y)) / inside.length };
		});
	}
	return {
		points,
		xName: poster.fields[view.x].name,
		agg: view.agg,
		yName: poster.fields[view.y].name,
		series: [...new Set(points.map((point) => point.series))]
	};
}
