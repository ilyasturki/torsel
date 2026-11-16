import { describe, expect, it } from 'vitest';

import { serially } from './serial.ts';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function within<T>(promise: Promise<T>, ms = 1000): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_settle, fail) =>
			setTimeout(() => fail(new Error(`still pending after ${ms} ms`)), ms)
		)
	]);
}

describe('serially', () => {
	it('runs calls with the same key one after another', async () => {
		const order: string[] = [];
		await Promise.all([
			serially('a', async () => {
				order.push('first in');
				await pause(20);
				order.push('first out');
			}),
			serially('a', async () => {
				order.push('second');
			})
		]);
		expect(order).toEqual(['first in', 'first out', 'second']);
	});

	it('runs a nested call with the same key inside the turn, and a later call after', async () => {
		const nested = serially('nest', () =>
			serially('other', () => serially('nest', async () => 'inner'))
		);
		expect(await within(nested)).toBe('inner');
		expect(await within(serially('nest', async () => 'later'))).toBe('later');
	});

	it('queues a call a finished turn left behind as its own turn', async () => {
		const order: string[] = [];
		let late: Promise<void> | undefined;
		await serially('timer', async () => {
			late = new Promise((settle) =>
				setTimeout(() => {
					void serially('timer', async () => {
						order.push('late');
					}).then(settle);
				}, 10)
			);
		});
		const holder = serially('timer', async () => {
			order.push('holder in');
			await pause(40);
			order.push('holder out');
		});
		await within(Promise.all([holder, late]));
		expect(order).toEqual(['holder in', 'holder out', 'late']);
	});
});
