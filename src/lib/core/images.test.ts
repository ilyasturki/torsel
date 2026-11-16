import { describe, expect, it } from 'vitest';

import { imagesOf, imagesText } from './images.ts';
import { coerce } from './values.ts';

const poster = {
	id: 'a'.repeat(64),
	type: 'image/jpeg',
	w: 342,
	h: 513,
	size: 63_663,
	name: 'dune.jpg'
};

describe('image values', () => {
	it('keeps well-formed refs and drops the rest', () => {
		const value = coerce({ type: 'image' }, [
			poster,
			{ ...poster, id: 'b'.repeat(64), type: 'image/svg+xml' },
			{ ...poster, id: 'not-a-hash' },
			{ ...poster, id: 'c'.repeat(64), w: 50_000, h: 50_000 },
			'https://example.com/poster.jpg',
			poster
		]);

		expect(value).toEqual([poster]);
	});

	it('reads anything else as no image', () => {
		expect(coerce({ type: 'image' }, 'poster.jpg')).toBeNull();
		expect(coerce({ type: 'image' }, [])).toBeNull();
		expect(coerce({ type: 'image' }, { ...poster })).toBeNull();
	});

	it('keeps only the fields a ref has', () => {
		expect(imagesOf([{ ...poster, src: 'javascript:alert(1)', extra: 1 }])).toEqual([poster]);
	});

	it('reads as its names in text', () => {
		const still = { id: 'd'.repeat(64), type: 'image/jpeg', w: 600, h: 338, size: 9000 };

		expect(imagesText([poster, still])).toBe(`dune.jpg, ${'d'.repeat(12)}`);
	});
});
