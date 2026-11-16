import { describe, expect, it } from 'vitest';

import { acceptedLanguages, pickLocale, plural } from './locale.ts';

type Catalog = { en: Record<string, unknown>; fr: Record<string, unknown> };

const areas = import.meta.glob<Catalog>(
	['./*.ts', '!./*.test.ts', '!./locale.ts', '!./runtime.ts'],
	{
		eager: true,
		import: 'default'
	}
);

// French that is the same word as the English, on purpose.
const SAME = new Set([
	'fields.suggestions',
	'fields.args.occurrence',
	'fields.args.date',
	'fields.args.type',
	'fields.args.condition',
	'fields.args.expression',
	'names.base',
	'names.table',
	'site.api',
	'shell.tables',
	'common.done',
	'changes.labels.type',
	'changes.labels.description',
	'changes.type',
	'fields.types.url',
	'fields.types.email',
	'fields.types.image',
	'images.more',
	'fields.types.date',
	'fields.groups.dates',
	'fields.type',
	'fields.auto',
	'fields.format',
	'fields.description',
	'grid.type',
	'home.table',
	'importing.base',
	'settings.agents',
	'views.total',
	'login.email',
	'site.github',
	'site.llms',
	'sources.brands.letterboxd',
	'sources.brands.sheet',
	'sources.brands.github'
]);

const SAMPLES: unknown[][] = [
	[],
	[2],
	['Kg'],
	[2, 'Kg'],
	['Kg', 2],
	['Kg', 'Kg'],
	['Kg', 'Kg', 'Kg'],
	[2, 3],
	[2, 3, 'Kg']
];

function call(message: (...args: unknown[]) => unknown): unknown[] {
	return SAMPLES.filter((args) => args.length === message.length).flatMap((args) => {
		try {
			return [message(...args)];
		} catch {
			return [];
		}
	});
}

function leaves(value: unknown, path: string): [string, unknown][] {
	if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
		return Object.entries(value).flatMap(([key, child]) => leaves(child, `${path}.${key}`));
	}
	return [[path, value]];
}

for (const [file, catalog] of Object.entries(areas)) {
	const name = file.slice(2, -3);
	describe(`${name} catalog`, () => {
		const en = new Map(leaves(catalog.en, name));
		const fr = new Map(leaves(catalog.fr, name));

		it('has every key in French', () => {
			expect([...fr.keys()].sort()).toEqual([...en.keys()].sort());
		});

		it('says it in French', () => {
			const english = [...en].filter(([key, value]) => {
				const french = fr.get(key);
				if (SAME.has(key)) return false;
				if (typeof value === 'function' && typeof french === 'function') {
					const ours = call(value as (...args: unknown[]) => unknown);
					const theirs = call(french as (...args: unknown[]) => unknown);
					return ours.length > 0 && ours.every((text, at) => text === theirs[at]);
				}
				return typeof value === 'string' && value === french;
			});
			expect(english.map(([key]) => key)).toEqual([]);
		});

		it('sets French punctuation with no-break spaces', () => {
			const loose = [...fr].filter(([, value]) => {
				const texts =
					typeof value === 'function'
						? call(value as (...args: unknown[]) => unknown).map(String)
						: [String(value)];
				return texts.some((text) => /« | »| [:;?!](\s|$)/u.test(text.replace(/<[^>]*>/gu, '')));
			});
			expect(loose.map(([key]) => key)).toEqual([]);
		});

		it('takes the same parameters and words every one', () => {
			for (const [key, value] of en) {
				const french = fr.get(key);
				if (typeof value !== 'function') continue;
				expect(typeof french, key).toBe('function');
				const message = french as (...args: unknown[]) => unknown;
				expect(message.length, key).toBe((value as () => unknown).length);
				for (const text of [...call(value as (...args: unknown[]) => unknown), ...call(message)]) {
					expect(String(text), key).not.toMatch(/undefined|NaN|\[object/u);
				}
			}
		});
	});
}

describe('locale', () => {
	it('picks the first supported language', () => {
		expect(pickLocale(['de-DE', 'fr-CA', 'en'])).toBe('fr');
		expect(pickLocale(['de-DE'])).toBe('en');
		expect(pickLocale([])).toBe('en');
	});

	it('reads Accept-Language by weight', () => {
		expect(acceptedLanguages('de-DE,fr;q=0.5,en;q=0.8,it;q=0')).toEqual(['de-DE', 'en', 'fr']);
		expect(acceptedLanguages(null)).toEqual([]);
	});

	it('counts 0 and 1 as singular in French only', () => {
		const forms = { one: '# ligne', other: '# lignes' };
		expect(plural('fr', 0, forms)).toBe('0 ligne');
		expect(plural('fr', 1, forms)).toBe('1 ligne');
		expect(plural('fr', 2, forms)).toBe('2 lignes');
		expect(plural('en', 0, { one: '# row', other: '# rows' })).toBe('0 rows');
	});
});
