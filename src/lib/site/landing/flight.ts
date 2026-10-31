export type FlightCell = { x: number; y: number; w: number; h: number; color: string };

const CELLS = '.size-mark, svg rect, [data-cell]';
const MAX_CELLS = 120;
const DURATION = 260;

/** Every coloured mark in a view, relative to the box: a row's chip, a chart's bar. */
export function readCells(box: HTMLElement): FlightCell[] {
	const frame = box.getBoundingClientRect();
	const cells: FlightCell[] = [];
	for (const node of box.querySelectorAll<HTMLElement | SVGElement>(CELLS)) {
		const rect = node.getBoundingClientRect();
		const visible =
			rect.width > 0 &&
			rect.bottom > frame.top &&
			rect.top < frame.bottom &&
			rect.left < frame.right;
		if (!visible) continue;
		const style = getComputedStyle(node);
		cells.push({
			x: rect.left - frame.left,
			y: rect.top - frame.top,
			w: rect.width,
			h: rect.height,
			color: node instanceof SVGElement ? style.fill : style.backgroundColor
		});
		if (cells.length === MAX_CELLS) break;
	}
	return cells;
}

/** Moves each cell of the old view once to a cell of the same colour in the new one. */
export function fly(canvas: HTMLCanvasElement, from: FlightCell[], to: FlightCell[]): void {
	const context = canvas.getContext('2d');
	if (context === null) return;
	const width = canvas.clientWidth;
	const height = canvas.clientHeight;
	const ratio = Math.min(devicePixelRatio || 1, 2);
	canvas.width = width * ratio;
	canvas.height = height * ratio;

	const free = new Map<string, FlightCell[]>();
	for (const cell of to) {
		free.set(cell.color, [...(free.get(cell.color) ?? []), cell]);
	}
	const moves = from.flatMap((cell) => {
		const target = free.get(cell.color)?.shift();
		return target === undefined ? [] : [{ from: cell, to: target }];
	});
	if (moves.length === 0) return;

	const start = performance.now();
	const frame = (now: number): void => {
		const t = Math.min(1, (now - start) / DURATION);
		const k = 1 - Math.pow(1 - t, 3);
		context.setTransform(ratio, 0, 0, ratio, 0, 0);
		context.clearRect(0, 0, width, height);
		for (const move of moves) {
			context.fillStyle = move.from.color;
			context.fillRect(
				move.from.x + (move.to.x - move.from.x) * k,
				move.from.y + (move.to.y - move.from.y) * k,
				move.from.w + (move.to.w - move.from.w) * k,
				move.from.h + (move.to.h - move.from.h) * k
			);
		}
		if (t < 1) requestAnimationFrame(frame);
		else context.clearRect(0, 0, width, height);
	};
	requestAnimationFrame(frame);
}
