const MAX_ALPHA = 22;
const HOVER_ALPHA = 24;
const FRAME_MS = 100;
const REACH = 3;

function rgb(value: string): [number, number, number] {
	const match = /^#(..)(..)(..)$/u.exec(value.trim());
	return match === null
		? [128, 128, 128]
		: [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
}

/** A slow drift of cells behind the page, one pixel per cell, scaled up by the compositor. */
export class Backdrop {
	private readonly context: CanvasRenderingContext2D;
	private columns = 0;
	private rows = 0;
	private pitch = 34;
	private image: ImageData;
	private values = new Float32Array(0);
	private lift = new Float32Array(0);
	private first = [0, 0, 0];
	private second = [0, 0, 0];
	private pointer: { x: number; y: number } | null = null;
	private frame = 0;
	private last = 0;

	public constructor(private readonly canvas: HTMLCanvasElement) {
		this.context = canvas.getContext('2d') as CanvasRenderingContext2D;
		this.image = this.context.createImageData(1, 1);
		this.resize();
		this.readColors();
	}

	public readColors(): void {
		const style = getComputedStyle(document.documentElement);
		this.first = rgb(style.getPropertyValue('--d-blue'));
		this.second = rgb(style.getPropertyValue('--d-violet'));
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
		this.lift = new Float32Array(this.columns * this.rows);
	}

	public draw(now: number, jump = false): void {
		const time = (now / 1000) * 0.3 + scrollY * 0.0012;
		const { columns, rows, values, lift, first, second, pointer } = this;
		const data = this.image.data;
		for (let y = 0, index = 0; y < rows; y++) {
			for (let x = 0; x < columns; x++, index++) {
				const wave =
					Math.sin(x * 0.3 + time) +
					Math.sin(y * 0.37 - time * 0.74) +
					Math.sin((x + y) * 0.17 + time * 0.46);
				const target = Math.min(1, Math.max(0, (wave + 0.6) / 2.2));
				values[index] += (target - values[index]) * (jump ? 1 : 0.2);
				let near = 0;
				if (pointer !== null) {
					const distance = Math.hypot(x - pointer.x, y - pointer.y);
					if (distance < REACH) near = 1 - distance / REACH;
				}
				lift[index] += (near - lift[index]) * 0.3;
				const mix = (Math.sin(x * 0.13 + y * 0.11) + 1) / 2;
				const offset = index * 4;
				data[offset] = first[0] + (second[0] - first[0]) * mix;
				data[offset + 1] = first[1] + (second[1] - first[1]) * mix;
				data[offset + 2] = first[2] + (second[2] - first[2]) * mix;
				data[offset + 3] = values[index] * MAX_ALPHA + lift[index] * HOVER_ALPHA;
			}
		}
		this.context.putImageData(this.image, 0, 0);
	}

	public start(): void {
		const run = (now: number): void => {
			this.frame = requestAnimationFrame(run);
			if (document.hidden || now - this.last < FRAME_MS) return;
			this.last = now;
			this.draw(now);
		};
		this.frame = requestAnimationFrame(run);
	}

	public stop(): void {
		cancelAnimationFrame(this.frame);
	}

	public moveTo(clientX: number, clientY: number): void {
		this.pointer = { x: clientX / this.pitch, y: clientY / this.pitch };
	}

	public leave(): void {
		this.pointer = null;
	}
}
