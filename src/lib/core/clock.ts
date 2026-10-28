// Hybrid logical clock, fixed-width so that string order is causal order.
export type Clock = string;

const WALL_WIDTH = 9;
const COUNT_WIDTH = 4;

export function formatClock(wall: number, count: number, node: string): Clock {
	return `${wall.toString(36).padStart(WALL_WIDTH, '0')}.${count.toString(36).padStart(COUNT_WIDTH, '0')}.${node}`;
}

export function parseClock(clock: Clock): { wall: number; count: number; node: string } {
	const [wall = '0', count = '0', node = ''] = clock.split('.');

	return { wall: parseInt(wall, 36), count: parseInt(count, 36), node };
}

export function isClock(value: unknown): value is Clock {
	return typeof value === 'string' && /^[0-9a-z]{9}\.[0-9a-z]{4}\.[0-9a-z_-]{1,32}$/u.test(value);
}

export class Hlc {
	private wall = 0;
	private count = 0;

	public constructor(
		public readonly node: string,
		private readonly now: () => number = Date.now
	) {}

	public tick(): Clock {
		const time = this.now();

		if (time > this.wall) {
			this.wall = time;
			this.count = 0;
		} else {
			this.count += 1;
		}

		return formatClock(this.wall, this.count, this.node);
	}

	public observe(clock: Clock): void {
		const { wall, count } = parseClock(clock);

		if (wall > this.wall || (wall === this.wall && count > this.count)) {
			this.wall = wall;
			this.count = count;
		}
	}
}
