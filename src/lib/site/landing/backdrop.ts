const PALETTE = ['blue', 'violet', 'pink', 'orange', 'amber', 'green', 'teal'];
// At rest the field only drifts: a few frames a second are enough.
const REST_MS = 66;
const BRUSH = 2.4;
const FADE_MS = 1100;
// Cells of pointer travel before the brush moves to the next colour.
const HUE_CELLS = 7;

type Rgb = [number, number, number];
type Wave = { x: number; y: number; start: number; color: Rgb };

const WAVE_SPEED = 26;
const WAVE_WIDTH = 2.6;
const WAVE_REACH = 48;

function rgb(value: string): Rgb {
	const match = /^#(..)(..)(..)$/u.exec(value.trim());
	return match === null
		? [128, 128, 128]
		: [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
}

let waving: ((clientX: number, clientY: number) => void) | null = null;

export function wave(clientX: number, clientY: number): void {
	waving?.(clientX, clientY);
}

/** Cells behind the page, one pixel each scaled up by the compositor, painted where the pointer passes. */
export class Backdrop {
	private readonly context: CanvasRenderingContext2D;
	private columns = 0;
	private rows = 0;
	private pitch = 34;
	private image: ImageData;
	private values = new Float32Array(0);
	private ink = new Float32Array(0);
	private inkColor = new Float32Array(0);
	private palette: Rgb[] = [];
	private restAlpha = 0;
	private inkAlpha = 0;
	private waves: Wave[] = [];
	private last: { x: number; y: number } | null = null;
	private hue = 0;
	private active = 0;
	private alive = false;
	private drawn: number | undefined;
	private frame = 0;

	public constructor(private readonly canvas: HTMLCanvasElement) {
		this.context = canvas.getContext('2d') as CanvasRenderingContext2D;
		this.image = this.context.createImageData(1, 1);
		this.resize();
		this.readColors();
		waving = (clientX, clientY) => this.wave(clientX, clientY);
	}

	public readColors(): void {
		const style = getComputedStyle(document.documentElement);
		this.palette = PALETTE.map((name) => rgb(style.getPropertyValue(`--d-${name}`)));
		this.restAlpha = parseFloat(style.getPropertyValue('--site-rest')) * 255;
		this.inkAlpha = parseFloat(style.getPropertyValue('--site-ink')) * 255;
		this.draw(performance.now(), true);
	}

	public resize(): void {
		const style = getComputedStyle(document.documentElement);
		this.pitch = parseInt(style.getPropertyValue('--site-cell'), 10) || 34;
		this.columns = Math.ceil(innerWidth / this.pitch) + 1;
		this.rows = Math.ceil(Math.max(innerHeight, screen.height) / this.pitch) + 1;
		this.canvas.width = this.columns;
		this.canvas.height = this.rows;
		this.canvas.style.width = `${this.columns * this.pitch}px`;
		this.canvas.style.height = `${this.rows * this.pitch}px`;
		this.image = this.context.createImageData(this.columns, this.rows);
		this.values = new Float32Array(this.columns * this.rows);
		this.ink = new Float32Array(this.columns * this.rows);
		this.inkColor = new Float32Array(this.columns * this.rows * 3);
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

	private stamp(cx: number, cy: number): void {
		const color = this.color(this.hue);
		const top = Math.max(0, Math.floor(cy - BRUSH));
		const bottom = Math.min(this.rows - 1, Math.ceil(cy + BRUSH));
		const left = Math.max(0, Math.floor(cx - BRUSH));
		const right = Math.min(this.columns - 1, Math.ceil(cx + BRUSH));
		for (let y = top; y <= bottom; y++) {
			for (let x = left; x <= right; x++) {
				const strength = 1 - Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / BRUSH;
				const index = y * this.columns + x;
				if (strength > this.ink[index]) {
					this.ink[index] = strength;
					this.inkColor.set(color, index * 3);
				}
			}
		}
	}

	public draw(now: number, jump = false): void {
		const elapsed = this.drawn === undefined ? 16 : Math.min(100, now - this.drawn);
		this.drawn = now;
		const time = (now / 1000) * 0.3 + scrollY * 0.0012;
		const fade = Math.exp(-elapsed / FADE_MS);
		const { columns, rows, values, ink, inkColor, restAlpha, inkAlpha } = this;
		this.waves = this.waves.filter(
			(item) => ((now - item.start) / 1000) * WAVE_SPEED < WAVE_REACH + WAVE_WIDTH
		);
		const data = this.image.data;
		let alive = this.waves.length > 0;
		for (let y = 0, index = 0; y < rows; y++) {
			for (let x = 0; x < columns; x++, index++) {
				const field =
					Math.sin(x * 0.3 + time) +
					Math.sin(y * 0.37 - time * 0.74) +
					Math.sin((x + y) * 0.17 + time * 0.46);
				const target = Math.min(1, Math.max(0, (field + 0.4) / 2.4));
				values[index] += (target - values[index]) * (jump ? 1 : 0.2);
				const rest = this.color(x * 0.05 + y * 0.07 + time * 0.12);
				ink[index] *= fade;
				let strength = ink[index];
				let red = inkColor[index * 3];
				let green = inkColor[index * 3 + 1];
				let blue = inkColor[index * 3 + 2];
				for (const item of this.waves) {
					const radius = ((now - item.start) / 1000) * WAVE_SPEED;
					const distance = Math.hypot(x + 0.5 - item.x, y + 0.5 - item.y);
					const near =
						Math.max(0, 1 - Math.abs(distance - radius) / WAVE_WIDTH) *
						Math.max(0, 1 - radius / WAVE_REACH);
					if (near > strength) {
						strength = near;
						[red, green, blue] = item.color;
					}
				}
				if (strength > 0.01) alive = true;
				const mix = Math.min(1, strength * 1.5);
				const offset = index * 4;
				data[offset] = rest[0] + (red - rest[0]) * mix;
				data[offset + 1] = rest[1] + (green - rest[1]) * mix;
				data[offset + 2] = rest[2] + (blue - rest[2]) * mix;
				data[offset + 3] = Math.max(values[index] * restAlpha, strength * inkAlpha);
			}
		}
		this.context.putImageData(this.image, 0, 0);
		this.alive = alive;
	}

	public start(): void {
		const run = (now: number): void => {
			this.frame = requestAnimationFrame(run);
			if (document.hidden) return;
			const busy = this.alive || now - this.active < 400;
			if (!busy && now - (this.drawn ?? 0) < REST_MS) return;
			this.draw(now);
		};
		this.frame = requestAnimationFrame(run);
	}

	public stop(): void {
		cancelAnimationFrame(this.frame);
		waving = null;
	}

	public moveTo(clientX: number, clientY: number): void {
		const x = clientX / this.pitch;
		const y = clientY / this.pitch;
		const from = this.last ?? { x, y };
		const distance = Math.hypot(x - from.x, y - from.y);
		const steps = Math.max(1, Math.ceil(distance * 2));
		for (let step = 1; step <= steps; step++) {
			this.hue += distance / steps / HUE_CELLS;
			this.stamp(from.x + ((x - from.x) * step) / steps, from.y + ((y - from.y) * step) / steps);
		}
		this.last = { x, y };
		this.active = performance.now();
	}

	public leave(): void {
		this.last = null;
	}

	public wave(clientX: number, clientY: number): void {
		this.hue += 2;
		this.active = performance.now();
		this.waves.push({
			x: clientX / this.pitch,
			y: clientY / this.pitch,
			start: this.active,
			color: this.color(this.hue)
		});
	}
}
