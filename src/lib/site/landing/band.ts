import type { DataColor } from '#lib/ui/colors.ts';

import type { Mark, Year } from './year.ts';

export type BandView = {
	id: string;
	label: string;
	table: number | null;
	title: string;
	/** Columns by month, by week, or one per group. */
	by: 'month' | 'week' | 'group' | null;
};

export const BAND_VIEWS: BandView[] = [
	{ id: 'all', label: 'All', table: null, title: '', by: null },
	{ id: 'budget', label: 'Budget', table: 0, title: 'Rows per month, by category', by: 'month' },
	{
		id: 'clients',
		label: 'Clients',
		table: 1,
		title: 'One cell per client, by stage',
		by: 'group'
	},
	{ id: 'projects', label: 'Projects', table: 2, title: 'Tasks per week, by status', by: 'week' },
	{
		id: 'jobs',
		label: 'Job search',
		table: 3,
		title: 'One cell per application, by status',
		by: 'group'
	},
	{ id: 'trip', label: 'Trip', table: 4, title: 'One cell per booking, by kind', by: 'group' },
	{ id: 'reading', label: 'Reading', table: 5, title: 'One cell per book, by status', by: 'group' }
];

type Cell = Mark & {
	x: number;
	y: number;
	size: number;
	alpha: number;
	shown: DataColor;
	toX: number;
	toY: number;
	toSize: number;
	toAlpha: number;
	toColor: DataColor;
	fromX: number;
	fromY: number;
	fromSize: number;
	fromAlpha: number;
};

type Overlay = (context: CanvasRenderingContext2D, alpha: number) => void;

const FONT = '"Funnel Sans Variable", system-ui, sans-serif';
const DURATION = 420;
const easeOut = (t: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

/** One cell per row of a year. Each view is the same cells in another place. */
export class CellBand {
	public current = 'all';
	public hovered: Cell | null = null;

	private readonly context: CanvasRenderingContext2D;
	private readonly cells: Cell[];
	private width = 0;
	private height = 0;
	private ratio = 1;
	private overlay: Overlay | null = null;
	private overlayAlpha = 0;
	private raf = 0;
	private animating = false;
	private started = 0;
	private colors: Record<string, string> = {};

	public constructor(
		private readonly canvas: HTMLCanvasElement,
		private readonly year: Year,
		private readonly reduced: boolean
	) {
		this.context = canvas.getContext('2d') as CanvasRenderingContext2D;
		this.cells = year.marks.map((mark) => ({
			...mark,
			x: 0,
			y: 0,
			size: 0,
			alpha: 0,
			shown: mark.color,
			toX: 0,
			toY: 0,
			toSize: 0,
			toAlpha: 1,
			toColor: mark.color,
			fromX: 0,
			fromY: 0,
			fromSize: 0,
			fromAlpha: 0
		}));
		this.readColors();
		this.resize();
	}

	public readColors(): void {
		const style = getComputedStyle(document.documentElement);
		const read = (name: string): string => style.getPropertyValue(`--${name}`).trim();
		this.colors = { ink: read('ink'), 'ink-2': read('ink-2'), 'ink-3': read('ink-3') };
		for (const color of ['gray', 'orange', 'amber', 'green', 'teal', 'blue', 'violet', 'pink']) {
			this.colors[color] = read(`d-${color}`);
		}
		this.schedule();
	}

	public resize(): void {
		const box = this.canvas.getBoundingClientRect();
		this.width = Math.round(box.width);
		this.height = Math.round(box.height);
		this.ratio = Math.min(devicePixelRatio || 1, 2);
		this.canvas.width = this.width * this.ratio;
		this.canvas.height = this.height * this.ratio;
		this.place(this.current);
		this.settle();
		this.schedule();
	}

	private waffle(
		items: Cell[],
		column: (cell: Cell) => number,
		x0: number,
		bottom: number,
		columnWidth: number,
		columns: number,
		tallest: number,
		order: ((a: Cell, b: Cell) => number) | null,
		largest: number
	): void {
		const buckets: Cell[][] = Array.from({ length: columns }, () => []);
		for (const cell of items) buckets[column(cell)].push(cell);
		if (order !== null) for (const bucket of buckets) bucket.sort(order);

		let unit = 2;
		let perColumn = Math.max(1, Math.floor(columnWidth / 2));
		for (let candidate = Math.min(columnWidth, largest); candidate >= 2; candidate -= 0.5) {
			const fit = Math.max(1, Math.floor(columnWidth / candidate));
			const rows = Math.max(...buckets.map((bucket) => Math.ceil(bucket.length / fit)));
			if (rows * candidate <= tallest) {
				unit = candidate;
				perColumn = fit;
				break;
			}
		}

		const inset = (columnWidth - perColumn * unit) / 2;
		buckets.forEach((bucket, index) => {
			bucket.forEach((cell, position) => {
				cell.toX = x0 + index * columnWidth + inset + (position % perColumn) * unit;
				cell.toY = bottom - (Math.floor(position / perColumn) + 1) * unit;
				cell.toSize = Math.max(1, unit - 1);
			});
		});
	}

	private place(id: string): void {
		const { width, height, cells } = this;
		const narrow = width < 720;
		const view = BAND_VIEWS.find((item) => item.id === id) ?? BAND_VIEWS[0];
		const area = {
			x: narrow ? 16 : 24,
			y: 40,
			w: width - (narrow ? 32 : 48),
			h: height - 62
		};
		this.overlay = null;
		this.waffle(
			cells,
			(cell) => cell.week,
			0,
			height,
			width / 52,
			52,
			height * 0.98,
			(a, b) => a.table - b.table,
			16
		);
		for (const cell of cells) {
			cell.toAlpha = 1;
			cell.toColor = cell.color;
		}
		if (view.table === null) return;

		for (const cell of cells) {
			if (cell.table !== view.table) cell.toAlpha = 0;
		}
		const focus = cells.filter((cell) => cell.table === view.table);
		for (const cell of focus) cell.toColor = cell.alt;
		const legend = this.year.legends[view.table];
		const order = legend.map(([name]) => name);
		const byGroup = (a: Cell, b: Cell): number => order.indexOf(a.group) - order.indexOf(b.group);

		if (view.by === 'group') {
			this.waffle(
				focus,
				(cell) => order.indexOf(cell.group),
				area.x,
				area.y + area.h,
				area.w / order.length,
				order.length,
				area.h,
				null,
				narrow ? 18 : 24
			);
		} else if (view.by === 'month') {
			this.waffle(
				focus,
				(cell) => cell.month,
				area.x,
				area.y + area.h,
				area.w / 12,
				12,
				area.h,
				byGroup,
				16
			);
		} else {
			this.waffle(
				focus,
				(cell) => cell.week,
				area.x,
				area.y + area.h,
				area.w / 52,
				52,
				area.h,
				byGroup,
				16
			);
		}

		this.overlay = (context, alpha) => {
			context.globalAlpha = alpha;
			context.textAlign = 'left';
			context.font = `500 13.5px ${FONT}`;
			context.fillStyle = this.colors.ink;
			context.fillText(view.title, area.x, 16);
			let x = area.x;
			context.font = `400 12.5px ${FONT}`;
			for (const [text, color] of legend) {
				context.fillStyle = this.colors[color];
				context.fillRect(x, 24, 8, 8);
				context.fillStyle = this.colors['ink-2'];
				context.fillText(text, x + 12, 32);
				x += 12 + context.measureText(text).width + 10;
			}
			context.font = `400 12px ${FONT}`;
			context.fillStyle = this.colors['ink-3'];
			if (view.by === 'group') {
				context.textAlign = 'center';
				order.forEach((text, index) => {
					context.fillText(
						text,
						area.x + ((index + 0.5) * area.w) / order.length,
						area.y + area.h + 15
					);
				});
			} else {
				context.fillText('A year ago', area.x, area.y + area.h + 15);
				context.textAlign = 'right';
				context.fillText(
					view.by === 'month' ? 'This month' : 'This week',
					area.x + area.w,
					area.y + area.h + 15
				);
			}
			context.globalAlpha = 1;
		};
	}

	private settle(): void {
		for (const cell of this.cells) {
			cell.x = cell.toX;
			cell.y = cell.toY;
			cell.size = cell.toSize;
			cell.alpha = cell.toAlpha;
			cell.shown = cell.toColor;
		}
		this.overlayAlpha = this.overlay === null ? 0 : 1;
	}

	public go(id: string): void {
		this.current = id;
		this.place(id);
		if (this.reduced) {
			this.settle();
			this.schedule();
			return;
		}
		for (const cell of this.cells) {
			cell.fromX = cell.x;
			cell.fromY = cell.y;
			cell.fromSize = cell.size;
			cell.fromAlpha = cell.alpha;
		}
		this.overlayAlpha = 0;
		this.started = performance.now();
		this.animating = true;
		this.schedule();
	}

	public schedule(): void {
		if (this.raf === 0) this.raf = requestAnimationFrame((now) => this.step(now));
	}

	private step(now: number): void {
		this.raf = 0;
		let live = false;
		if (this.animating) {
			const elapsed = now - this.started;
			const k = easeOut(elapsed / DURATION);
			for (const cell of this.cells) {
				cell.x = cell.fromX + (cell.toX - cell.fromX) * k;
				cell.y = cell.fromY + (cell.toY - cell.fromY) * k;
				cell.size = cell.fromSize + (cell.toSize - cell.fromSize) * k;
				cell.alpha = cell.fromAlpha + (cell.toAlpha - cell.fromAlpha) * k;
				if (k > 0.5) cell.shown = cell.toColor;
			}
			this.overlayAlpha = Math.min(1, Math.max(0, (elapsed - 240) / 160));
			if (k < 1) {
				live = true;
			} else {
				this.animating = false;
				this.settle();
			}
		}
		this.draw();
		if (live) this.schedule();
	}

	public draw(): void {
		const context = this.context;
		context.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
		context.clearRect(0, 0, this.width, this.height);
		let color = '';
		let alpha = -1;
		for (const cell of this.cells) {
			if (cell.alpha < 0.005) continue;
			if (cell.shown !== color) {
				color = cell.shown;
				context.fillStyle = this.colors[color];
			}
			if (cell.alpha !== alpha) {
				alpha = cell.alpha;
				context.globalAlpha = alpha;
			}
			context.fillRect(cell.x, cell.y, cell.size, cell.size);
		}
		context.globalAlpha = 1;
		if (this.hovered !== null && this.hovered.alpha > 0.5) {
			context.strokeStyle = this.colors.ink;
			context.lineWidth = 2;
			const { x, y, size } = this.hovered;
			context.strokeRect(x - 1, y - 1, size + 2, size + 2);
		}
		if (this.overlay !== null && this.overlayAlpha > 0) this.overlay(context, this.overlayAlpha);
	}

	public cellAt(x: number, y: number): Cell | null {
		for (const cell of this.cells) {
			if (
				cell.alpha > 0.5 &&
				x >= cell.x &&
				x <= cell.x + cell.size + 1 &&
				y >= cell.y &&
				y <= cell.y + cell.size + 1
			) {
				return cell;
			}
		}
		return null;
	}
}
