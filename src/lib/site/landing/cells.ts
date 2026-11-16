const PALETTE = ['blue', 'violet', 'pink', 'orange', 'amber', 'green', 'teal'];
// Each redraw makes the compositor blur every panel over it again: 30 a second while moving, fewer at rest.
const ACTIVE_MS = 33;
const REST_MS = 66;
const GROW_MS = 1800;
const BRUSH = 3.2;
// Cells of pointer travel before the brush moves to the next colour.
const HUE_CELLS = 9;
// Every bar takes three columns: two drawn, one left empty between bars.
const BAR = 3;

type Rgb = [number, number, number];

export type Shape = 'chart' | 'band';

/** The cells the copy sits on, in cells from the field's top left: no bar rises into them. */
export type Keep = { left: number; right: number; bottom: number };

function rgb(value: string): Rgb {
	const match = /^#(..)(..)(..)$/u.exec(value.trim());
	return match === null
		? [128, 128, 128]
		: [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
}

/** A field of cells owned by one section, one pixel each scaled up by the compositor, painted where the pointer passes. */
export class Field {
	private readonly context: CanvasRenderingContext2D;
	private columns = 0;
	private rows = 0;
	private image: ImageData | null = null;
	private ink = new Float32Array(0);
	private inkHue = new Float32Array(0);
	private bars: number[] = [];
	private palette: Rgb[] = [];
	private hue = 0;
	private last: { x: number; y: number } | null = null;
	private frame = 0;
	private drawn = 0;
	private active = 0;
	private readonly born = performance.now();
	private dark = false;

	public constructor(
		private readonly canvas: HTMLCanvasElement,
		private readonly shape: Shape,
		private readonly still: boolean
	) {
		this.context = canvas.getContext('2d') as CanvasRenderingContext2D;
	}

	public readColors(dark: boolean): void {
		const style = getComputedStyle(document.documentElement);
		this.palette = PALETTE.map((name) => rgb(style.getPropertyValue(`--d-${name}`)));
		this.dark = dark;
	}

	public resize(width: number, height: number, pitch: number, keep: Keep | null): void {
		this.columns = Math.max(1, Math.ceil(width / pitch));
		this.rows = Math.max(1, Math.ceil(height / pitch));
		this.canvas.width = this.columns;
		this.canvas.height = this.rows;
		this.canvas.style.width = `${this.columns * pitch}px`;
		this.canvas.style.height = `${this.rows * pitch}px`;
		this.image = this.context.createImageData(this.columns, this.rows);
		this.ink = new Float32Array(this.columns * this.rows);
		this.inkHue = new Float32Array(this.columns * this.rows);
		const count = Math.ceil(this.columns / BAR);
		this.bars = Array.from({ length: count }, (_, index) => {
			const along = index / Math.max(1, count - 1);
			const wobble = Math.sin(index * 1.7) * 0.035 + Math.sin(index * 0.6) * 0.025;
			let height = Math.min(0.94, Math.max(0.06, 0.12 + 0.8 * along ** 1.9 + wobble));
			const from = index * BAR;
			if (keep !== null && from + BAR > keep.left && from < keep.right) {
				height = Math.min(height, (this.rows - keep.bottom - 1) / this.rows);
			}
			return Math.max(0.04, height);
		});
	}

	private color(hue: number): Rgb {
		const count = this.palette.length;
		const at = ((hue % count) + count) % count;
		const index = Math.floor(at);
		const mix = at - index;
		const from = this.palette[index];
		const to = this.palette[(index + 1) % count];
		return [
			from[0] + (to[0] - from[0]) * mix,
			from[1] + (to[1] - from[1]) * mix,
			from[2] + (to[2] - from[2]) * mix
		];
	}

	public paint(x: number, y: number, pitch: number): void {
		const cx = x / pitch;
		const cy = y / pitch;
		const from = this.last ?? { x: cx, y: cy };
		const distance = Math.hypot(cx - from.x, cy - from.y);
		const steps = Math.max(1, Math.ceil(distance * 2));
		for (let step = 1; step <= steps; step++) {
			this.hue += distance / steps / HUE_CELLS;
			this.stamp(from.x + ((cx - from.x) * step) / steps, from.y + ((cy - from.y) * step) / steps);
		}
		this.last = { x: cx, y: cy };
		this.active = performance.now();
	}

	private stamp(px: number, py: number): void {
		const top = Math.max(0, Math.floor(py - BRUSH));
		const bottom = Math.min(this.rows - 1, Math.ceil(py + BRUSH));
		const left = Math.max(0, Math.floor(px - BRUSH));
		const right = Math.min(this.columns - 1, Math.ceil(px + BRUSH));
		for (let y = top; y <= bottom; y++) {
			for (let x = left; x <= right; x++) {
				const strength = 1 - Math.hypot(x + 0.5 - px, y + 0.5 - py) / BRUSH;
				const index = y * this.columns + x;
				if (strength > this.ink[index]) {
					this.ink[index] = strength;
					this.inkHue[index] = this.hue;
				}
			}
		}
	}

	public leave(): void {
		this.last = null;
	}

	/** Whether the bars are still rising or the pointer moved lately. */
	public get busy(): boolean {
		const now = performance.now();
		return now - this.born < GROW_MS || now - this.active < 1200;
	}

	public draw(now: number): void {
		const image = this.image;
		if (image === null || this.palette.length === 0) return;
		const t = this.still ? 0 : (now - this.born) / 1000;
		const grown = this.still ? 1 : Math.min(1, (now - this.born) / GROW_MS);
		const rise = 1 - (1 - grown) ** 3;
		const { columns, rows, ink, inkHue, dark } = this;
		const data = image.data;
		const quiet = dark ? 0.09 : 0.13;
		for (let y = 0, index = 0; y < rows; y++) {
			for (let x = 0; x < columns; x++, index++) {
				const field =
					Math.sin(x * 0.21 + t * 0.35) +
					Math.sin(y * 0.29 - t * 0.26) +
					Math.sin((x + y) * 0.13 + t * 0.16);
				const wave = Math.min(1, Math.max(0, (field + 0.5) / 2.5));
				let lit = false;
				if (this.shape === 'chart' && x % BAR !== BAR - 1) {
					lit = rows - y <= this.bars[Math.floor(x / BAR)] * rise * rows;
				}
				const rest =
					this.shape === 'band'
						? wave * (dark ? 0.55 : 0.6)
						: lit
							? 0.5 + wave * 0.45
							: wave * quiet;
				let [red, green, blue] = this.color(x * 0.035 + y * 0.05 + t * 0.08 + (lit ? 0 : 1.5));
				ink[index] *= 0.965;
				const strength = Math.min(1, ink[index] * 1.4);
				if (strength > 0.01) {
					const [r, g, b] = this.color(inkHue[index]);
					red += (r - red) * strength;
					green += (g - green) * strength;
					blue += (b - blue) * strength;
				}
				const offset = index * 4;
				data[offset] = red;
				data[offset + 1] = green;
				data[offset + 2] = blue;
				// The closing band carries its copy straight on the cells: its paint stays softer.
				data[offset + 3] = Math.max(rest, strength * (this.shape === 'band' ? 0.65 : 0.95)) * 255;
			}
		}
		this.context.putImageData(image, 0, 0);
		this.drawn = now;
	}

	public start(): void {
		if (this.frame !== 0) return;
		const run = (now: number): void => {
			this.frame = requestAnimationFrame(run);
			if (document.hidden) return;
			if (now - this.drawn < (this.busy ? ACTIVE_MS : REST_MS)) return;
			this.draw(now);
		};
		this.frame = requestAnimationFrame(run);
	}

	public stop(): void {
		cancelAnimationFrame(this.frame);
		this.frame = 0;
	}

	public get running(): boolean {
		return this.frame !== 0;
	}
}
