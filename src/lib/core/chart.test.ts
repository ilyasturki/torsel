import { describe, expect, it } from 'vitest';

import { axisTicks } from './chart.ts';

describe('axis ticks', () => {
	it('starts bars at zero and ends on a round value above the tallest', () => {
		expect(axisTicks(0, 1420)).toEqual([0, 500, 1000, 1500]);
		expect(axisTicks(0, 7)).toEqual([0, 2, 4, 6, 8]);
	});

	it('frames a weigh-in line closely, on round fifths', () => {
		expect(axisTicks(87.9, 88.4)).toEqual([87.8, 88, 88.2, 88.4]);
	});

	it('gives a flat line some room', () => {
		expect(axisTicks(80, 80)).toEqual([79, 79.5, 80, 80.5, 81]);
	});
});
