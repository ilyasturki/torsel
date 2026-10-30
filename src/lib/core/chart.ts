import type { ChartConfig, FieldDef } from './model.ts';
import type { Engine, SqlValue } from './sql.ts';
import type { Workspace } from './workspace.ts';

export type ChartPoint = { x: string; series: string; y: number };

export type ChartData = { points: ChartPoint[]; xLabel: string; yLabel: string; series: string[] };

const AGG_LABELS: Record<NonNullable<ChartConfig['agg']>, string> = {
	count: 'Row count',
	sum: 'Total',
	avg: 'Average',
	max: 'Highest',
	min: 'Lowest'
};

function bucketSql(field: FieldDef, bucket: ChartConfig['bucket']): string {
	const column = `t.${field.id}`;

	if (field.type !== 'date') {
		return field.type === 'check' ? `case ${column} when 1 then 'oui' else 'non' end` : column;
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

export function chartQuery(ws: Workspace, tableId: string, config: ChartConfig): string | null {
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

	const grouped = `select ${xSql} as x, ${series} as series, ${value} as y from v_${tableId} t where ${xSql} is not null group by 1, 2`;

	const rolling = config.rolling ?? null;
	if (
		config.kind === 'line' &&
		rolling !== null &&
		rolling > 1 &&
		x.type === 'date' &&
		(config.bucket ?? 'day') === 'day'
	) {
		return `select x, series, avg(y) over (partition by series order by julianday(x) range between ${rolling - 1} preceding and current row) as y from (${grouped}) order by x`;
	}

	return `${grouped} order by 1`;
}

export function chartData(
	engine: Engine,
	ws: Workspace,
	tableId: string,
	config: ChartConfig
): ChartData | null {
	const sql = chartQuery(ws, tableId, config);
	if (sql === null) {
		return null;
	}

	const rows = engine.all(sql);
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
	const agg = config.agg ?? 'count';

	return {
		points,
		xLabel: x?.name ?? '',
		yLabel:
			agg === 'count' ? AGG_LABELS.count : `${AGG_LABELS[agg]} ${(y?.name ?? '').toLowerCase()}`,
		series: [...series]
	};
}
