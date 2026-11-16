import { chartSetup, listLayout } from '../../core/actions.ts';
import type { ChartData } from '../../core/chart.ts';
import type { IdPrefix } from '../../core/ids.ts';
import { newId } from '../../core/ids.ts';
import { imagesOf, imagesValue } from '../../core/images.ts';
import type { ChartConfig, FieldDef, Rec, Value, ViewConfig, ViewDef } from '../../core/model.ts';
import type { Published, PublishedType } from '../../core/published.ts';
import { isPublishable } from '../../core/published.ts';
import type { SqlRow } from '../../core/sql.ts';
import type { Workspace } from '../../core/workspace.ts';
import { gridRows } from '../../views/grid.ts';

const FIELD_KEYS = [
	'name',
	'type',
	'choices',
	'step',
	'decimals',
	'grouping',
	'unit',
	'currency',
	'min',
	'max',
	'seconds',
	'dateStyle',
	'result'
] as const satisfies readonly (keyof FieldDef)[];

/** What the payload's figures come from: the owner's SQLite copy of the base, read in a worker. */
export type Compute = {
	computed(tableId: string): Promise<Map<string, SqlRow>>;
	chart(tableId: string, config: ChartConfig): Promise<ChartData | null>;
};

export type Built = { published: Published; images: Set<string> };

class Minted {
	private readonly ids = new Map<string, string>();

	public of(prefix: IdPrefix, id: string): string {
		let fresh = this.ids.get(id);
		if (fresh === undefined) {
			fresh = newId(prefix);
			this.ids.set(id, fresh);
		}
		return fresh;
	}

	public known(id: string | null | undefined): string | null {
		return id == null ? null : (this.ids.get(id) ?? null);
	}
}

type Shown = { fields: FieldDef[]; rows: Rec[]; chart: ChartConfig | null };

function shown(ws: Workspace, view: ViewDef, computed: Map<string, SqlRow>): Shown {
	const fields = ws.fields(view.table);
	const { config } = view;

	if (view.type === 'grid') {
		const hidden = new Set(config.hidden ?? []);
		return {
			fields: fields.filter((field) => !hidden.has(field.id)),
			rows: gridRows(ws, view.table, config, computed),
			chart: null
		};
	}

	if (view.type === 'list') {
		const layout = listLayout(fields, config);
		const keep = new Set(
			[layout.group, layout.title, ...layout.show, layout.cover].map((field) => field?.id)
		);
		return {
			fields: fields.filter((field) => keep.has(field.id)),
			rows: ws.rows(view.table),
			chart: null
		};
	}

	const setup = chartSetup(fields, config, ws.rows(view.table));
	const keep = new Set([setup.x, setup.agg === 'count' ? null : setup.y, setup.color]);
	return {
		fields: fields.filter((field) => keep.has(field.id)),
		rows: [],
		chart: setup
	};
}

function sentConfig(
	view: ViewDef,
	ids: Minted,
	ws: Workspace,
	chart: ChartConfig | null
): ViewConfig {
	const { config } = view;
	if (view.type === 'grid') {
		const widths: Record<string, number> = {};
		for (const [id, width] of Object.entries(config.widths ?? {})) {
			const fresh = ids.known(id);
			if (fresh !== null && typeof width === 'number') widths[fresh] = width;
		}
		return { widths };
	}
	if (view.type === 'list') {
		const layout = listLayout(ws.fields(view.table), config);
		return {
			group: ids.known(layout.group?.id),
			title: ids.known(layout.title?.id),
			show: layout.show.map((field) => ids.of('f', field.id)),
			cover: ids.known(layout.cover?.id)
		};
	}
	const setup = chart ?? {};
	return {
		kind: setup.kind,
		x: ids.known(setup.x),
		bucket: setup.bucket ?? null,
		agg: setup.agg,
		y: setup.agg === 'count' ? null : ids.known(setup.y),
		color: ids.known(setup.color),
		rolling: setup.rolling ?? null
	};
}

/** A row's name as a link shows it; never an id, should the primary field be a link. */
function titleOf(ws: Workspace, rowId: string): string {
	const row = ws.live(rowId);
	const primary = row === undefined ? undefined : ws.primaryField(row.parent);
	if (row === undefined || primary === undefined || primary.type === 'link') return '';
	const value = row.data[primary.id];
	return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

/** The rows a link field points to, each by its title: stub tables in the payload's own ids. */
class Targets {
	private readonly tables = new Map<string, Published['targets'][number]>();
	private readonly ids = new Minted();

	public constructor(private readonly ws: Workspace) {}

	public table(tableId: string): string {
		return this.stub(tableId).id;
	}

	public row(tableId: string, rowId: string): string | null {
		const target = this.ws.live(rowId);
		if (target?.kind !== 'row' || target.parent !== tableId) return null;
		const stub = this.stub(tableId);
		const known = this.ids.known(rowId);
		if (known !== null) return known;
		const id = this.ids.of('r', rowId);
		stub.rows.push({ id, title: titleOf(this.ws, rowId) });
		return id;
	}

	private stub(tableId: string): Published['targets'][number] {
		let stub = this.tables.get(tableId);
		if (stub === undefined) {
			stub = { id: newId('t'), field: newId('f'), rows: [] };
			this.tables.set(tableId, stub);
		}
		return stub;
	}

	public list(): Published['targets'] {
		return [...this.tables.values()];
	}
}

function fieldData(field: FieldDef, order: number, targets: Targets): Record<string, Value> {
	const data: Record<string, Value> = { order };
	for (const key of FIELD_KEYS) {
		data[key] = field[key] as Value;
	}
	if (field.type === 'link' && field.target !== null) data.target = targets.table(field.target);
	return data;
}

function cell(
	field: FieldDef,
	row: Rec,
	computed: Map<string, SqlRow>,
	targets: Targets,
	images: Set<string>
): Value | undefined {
	if (field.type === 'formula') return (computed.get(row.id)?.[field.id] ?? null) as Value;
	const value = row.data[field.id];
	if (value === undefined || value === null) return undefined;
	if (field.type === 'link') {
		return field.target === null || typeof value !== 'string'
			? undefined
			: (targets.row(field.target, value) ?? undefined);
	}
	if (field.type === 'image') {
		const refs = imagesOf(value);
		for (const ref of refs) images.add(ref.id);
		return imagesValue(refs) ?? undefined;
	}
	return value;
}

function chartFor(
	data: ChartData,
	fields: FieldDef[],
	setup: ChartConfig,
	ws: Workspace
): ChartData {
	const byId = new Map(fields.map((field) => [field.id, field]));
	const titled = (id: string | null | undefined) =>
		id != null && byId.get(id)?.type === 'link'
			? (value: string) => titleOf(ws, value)
			: (value: string) => value;
	const x = titled(setup.x);
	const series = titled(setup.color);
	return {
		points: data.points.map((point) => ({
			x: x(point.x),
			series: series(point.series),
			y: point.y
		})),
		xName: data.xName,
		agg: data.agg,
		yName: setup.agg === 'count' ? '' : data.yName,
		series: [...new Set(data.series.map(series))]
	};
}

/** The payload of a view's public link, or null when the view, its table or its base is gone, or it is an entry view. */
export async function buildPublished(
	ws: Workspace,
	viewId: string,
	compute: Compute
): Promise<Built | null> {
	const view = ws.view(viewId);
	const table = view === undefined ? undefined : ws.table(view.table);
	const base = table === undefined ? undefined : ws.base(table.base);
	if (view === undefined || table === undefined || base === undefined) return null;
	if (!isPublishable(view.type)) return null;

	const formulas =
		view.type !== 'chart' && ws.fields(table.id).some((field) => field.type === 'formula');
	const computed = formulas ? await compute.computed(table.id) : new Map<string, SqlRow>();
	const picked = shown(ws, view, computed);

	const ids = new Minted();
	const targets = new Targets(ws);
	const images = new Set<string>();

	const fields = picked.fields.map((field, order) => ({
		id: ids.of('f', field.id),
		data: fieldData(field, order, targets)
	}));

	const rows = picked.rows.map((row) => {
		const values: Record<string, Value> = {};
		for (const field of picked.fields) {
			const value = cell(field, row, computed, targets, images);
			if (value !== undefined) values[ids.of('f', field.id)] = value;
		}
		return { id: ids.of('r', row.id), values };
	});

	let chart: ChartData | null = null;
	if (picked.chart !== null) {
		const data = await compute.chart(table.id, picked.chart);
		chart = data === null ? null : chartFor(data, picked.fields, picked.chart, ws);
	}

	const published: Published = {
		base: { id: newId('b'), name: base.name },
		table: { id: newId('t'), name: table.name },
		view: {
			id: newId('v'),
			name: view.name,
			type: view.type as PublishedType,
			config: sentConfig(view, ids, ws, picked.chart)
		},
		fields,
		rows,
		targets: targets.list(),
		chart
	};
	return { published, images };
}
