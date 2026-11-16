import type { ChartConfig, FieldDef } from './model.ts';
import { isDated } from './model.ts';
import type { Engine, SqlValue } from './sql.ts';
import type { Workspace } from './workspace.ts';

export type ChartPoint = { x: string; series: string; y: number };

export type Aggregate = NonNullable<ChartConfig['agg']>;

/** `xName` and `yName` are field names; the view words the calculation. A check field's x reads 1 or 0. */
export type ChartData = {
	points: ChartPoint[];
	xName: string;
	agg: Aggregate;
	yName: string;
	series: string[];
};

function bucketSql(field: FieldDef, bucket: ChartConfig['bucket']): string {
	const column = `t.${field.id}`;

	if (!isDated(field.type)) {
		return field.type === 'check' ? `case ${column} when 1 then 1 else 0 end` : column;
	}

	const day = `substr(${column}, 1, 10)`;
	switch (bucket) {
		case 'week':
			return `date(${day}, '-6 days', 'weekday 1')`;
		case 'month':
			return `substr(${column}, 1, 7)`;
		default:
			return day;
	}
}

/** With `only`, the rows left are those whose ids it holds, bound as a JSON array. */
export function chartQuery(
	ws: Workspace,
	tableId: string,
	config: ChartConfig,
	only = false
): string | null {
	const x = config.x ? ws.field(config.x) : undefined;
	if (x === undefined) {
		return null;
	}

	const agg = config.agg ?? 'count';
	const y = config.y ? ws.field(config.y) : undefined;
	if (agg !== 'count' && y === undefined) {
		return null;
	}

	const color = config.color ? ws.field(config.color) : undefined;
	const xSql = bucketSql(x, config.bucket);
	const series = color === undefined ? "''" : `coalesce(t.${color.id}, '')`;
	const value = agg === 'count' ? 'count(*)' : `${agg}(t.${y?.id})`;

	const kept = only ? ' and t.id in (select value from json_each(?))' : '';
	const grouped = `select ${xSql} as x, ${series} as series, ${value} as y from v_${tableId} t where ${xSql} is not null${kept} group by 1, 2`;

	const rolling = config.rolling ?? null;
	if (
		config.kind === 'line' &&
		rolling !== null &&
		rolling > 1 &&
		isDated(x.type) &&
		(config.bucket ?? 'day') === 'day'
	) {
		return `select x, series, avg(y) over (partition by series order by julianday(x) range between ${rolling - 1} preceding and current row) as y from (${grouped}) order by x`;
	}

	return `${grouped} order by 1`;
}

function niceStep(raw: number): number {
	const power = 10 ** Math.floor(Math.log10(raw));
	const scaled = raw / power;
	return (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10) * power;
}

/** Round values from at or below `low` to at or above `high`, about `count` steps apart. */
export function axisTicks(low: number, high: number, count = 4): number[] {
	const [from, to] = high > low ? [low, high] : [low - 1, low + 1];
	const step = niceStep((to - from) / count);
	const first = Math.floor(from / step);
	const last = Math.ceil(to / step);
	return Array.from({ length: last - first + 1 }, (_, at) =>
		Number(((first + at) * step).toPrecision(12))
	);
}

/** Bars that add up across something other than time lead with their grand total. */
export function totalled(config: ChartConfig, byDate: boolean): boolean {
	return !byDate && config.kind === 'bar' && (config.agg === 'sum' || config.agg === 'count');
}

/** The number a chart leads with: its value at the latest x, else its grand total; `x` is empty for a total. */
export function headline(
	data: ChartData,
	config: ChartConfig,
	byDate: boolean
): { x: string; y: number } | null {
	const last = data.points.at(-1)?.x;
	if (last === undefined) {
		return null;
	}
	const sum = (points: ChartPoint[]): number => points.reduce((total, point) => total + point.y, 0);
	if (totalled(config, byDate)) {
		return { x: '', y: sum(data.points) };
	}
	const latest = data.points.filter((point) => point.x === last);
	return { x: last, y: config.kind === 'bar' ? sum(latest) : (latest.at(-1)?.y ?? 0) };
}

export function chartData(
	engine: Engine,
	ws: Workspace,
	tableId: string,
	config: ChartConfig,
	only: readonly string[] | null = null
): ChartData | null {
	const sql = chartQuery(ws, tableId, config, only !== null);
	if (sql === null) {
		return null;
	}

	const rows = engine.all(sql, only === null ? [] : [JSON.stringify(only)]);
	const points: ChartPoint[] = [];
	const series = new Set<string>();

	for (const row of rows) {
		const y = row.y;
		if (typeof y !== 'number') {
			continue;
		}
		const name = String(row.series ?? '');
		series.add(name);
		points.push({ x: String(row.x as SqlValue), series: name, y });
	}

	const x = ws.field(config.x ?? '');
	const y = config.y ? ws.field(config.y) : undefined;
	return {
		points,
		xName: x?.name ?? '',
		agg: config.agg ?? 'count',
		yName: y?.name ?? '',
		series: [...series]
	};
}
