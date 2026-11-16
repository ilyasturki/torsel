import { describe, expect, it } from 'vitest';

import { imageLinks, imagesOf, imagesText } from './images.ts';
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

	it('keeps where a fetched image came from, and reads as that link', () => {
		const fetched = {
			...poster,
			id: 'e'.repeat(64),
			src: 'https://image.tmdb.org/t/p/w342/dune.jpg'
		};

		expect(imagesOf([fetched])).toEqual([fetched]);
		expect(imagesText([fetched, poster])).toBe(`${fetched.src}, dune.jpg`);
		expect(imagesOf([{ ...poster, src: `https://example.com/${'a'.repeat(3000)}` }])).toEqual([
			poster
		]);
	});
});

describe('imageLinks', () => {
	it('reads each link of a text, a bare domain as https', () => {
		expect(
			imageLinks(
				'https://a.example/one.jpg, https://b.example/two.png\nc.example/three.webp  http://d.example/x'
			)
		).toEqual([
			'https://a.example/one.jpg',
			'https://b.example/two.png',
			'https://c.example/three.webp',
			'http://d.example/x'
		]);
	});

	it('keeps a comma inside a link, and drops what isn’t one', () => {
		expect(imageLinks('https://res.example/w_300,h_400/poster.jpg')).toEqual([
			'https://res.example/w_300,h_400/poster.jpg'
		]);
		expect(imageLinks('Dune part two')).toEqual([]);
		expect(imageLinks('dune.jpg, 3.5 ada@example.com')).toEqual([]);
		expect(imageLinks('javascript:alert(1) file:///etc/passwd')).toEqual([]);
	});
});
