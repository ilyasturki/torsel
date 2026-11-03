import { describe, expect, it } from 'vitest';

import { isId } from './ids.ts';
import { resolveSlug, slugify, slugsOf } from './slug.ts';

describe('slugify', () => {
	it.each([
		['Séries', 'series'],
		['Date watched', 'date-watched'],
		['  Body weight (kg) ', 'body-weight-kg'],
		['Rock & Roll!!', 'rock-roll'],
		['a_b.c/d', 'a-b-c-d'],
		['Œuvres ÇA', 'œuvres-ca'],
		['Курсы', 'курсы'],
		['2026', '2026'],
		['💪', ''],
		['...', '']
	])('%s → %s', (name, slug) => {
		expect(slugify(name)).toBe(slug);
	});

	it('keeps long names to a readable length, without a trailing hyphen', () => {
		const slug = slugify(`${'word '.repeat(30)}end`);
		expect(slug.length).toBeLessThanOrEqual(60);
		expect(slug.endsWith('-')).toBe(false);
	});

	it('never takes the shape of an id, so an id and a slug cannot be confused', () => {
		expect(isId(slugify('t_abcdefabcdef'))).toBe(false);
	});
});

describe('slugsOf', () => {
	const sets = { id: 't_k3fa9x0000aa', name: 'Sets' };
	const twin = { id: 't_q81z2m0000bb', name: 'sets' };
	const third = { id: 't_q81zzz0000cc', name: 'SETS' };

	it('gives the oldest of twins the plain slug and the later ones a piece of their id', () => {
		const slugs = slugsOf([sets, twin, third]);
		expect(slugs.get(sets.id)).toBe('sets');
		expect(slugs.get(twin.id)).toBe('sets-q81z');
		expect(slugs.get(third.id)).toBe('sets-q81zz');
	});

	it('leaves every slug alone when a later twin comes or goes', () => {
		expect(slugsOf([sets, twin]).get(twin.id)).toBe('sets-q81z');
		expect(slugsOf([sets, twin, { id: 't_zzzz', name: 'Sets' }]).get(twin.id)).toBe('sets-q81z');
		expect(slugsOf([sets]).get(sets.id)).toBe('sets');
	});

	it('steps aside for a name that spells a twin slug', () => {
		const odd = { id: 't_aaaa', name: 'Sets q81z' };
		const slugs = slugsOf([sets, odd, twin]);
		expect(slugs.get(odd.id)).toBe('sets-q81z');
		expect(slugs.get(twin.id)).toBe('sets-q81z2');
	});

	it('falls back to the id when a name has nothing to spell', () => {
		expect(slugsOf([{ id: 't_abc123', name: '💪' }]).get('t_abc123')).toBe('t_abc123');
	});
});

describe('resolveSlug', () => {
	const movies = { id: 't_movies0000aa', name: 'Movies' };
	const twin = { id: 't_k3fa9x0000bb', name: 'Movies' };

	it('reads an id, a slug and a twin slug', () => {
		const items = [movies, twin];
		const slugs = slugsOf(items);
		expect(resolveSlug('movies', items, slugs)).toBe(movies.id);
		expect(resolveSlug('movies-k3fa', items, slugs)).toBe(twin.id);
		expect(resolveSlug(twin.id, items, slugs)).toBe(twin.id);
		expect(resolveSlug('books', items, slugs)).toBeUndefined();
	});

	it('still reads a twin slug once the older twin is gone', () => {
		const items = [twin];
		expect(resolveSlug('movies-k3fa', items, slugsOf(items))).toBe(twin.id);
		expect(resolveSlug('movies-zzzz', items, slugsOf(items))).toBeUndefined();
	});
});
