import { afterEach, describe, expect, it } from 'vitest';

import type { Locale } from './locale.ts';
import { viewName } from './names.ts';
import { readServerLocale } from './runtime.ts';

function speak(locale: Locale | undefined): void {
	readServerLocale(() => locale);
}

describe('viewName', () => {
	afterEach(() => speak(undefined));

	it('shows a default name in the current language, numbered or not', () => {
		speak('fr');
		expect(viewName({ name: 'Grid', type: 'grid' })).toBe('Grille');
		expect(viewName({ name: 'Entry 2', type: 'entry' })).toBe('Saisie 2');
		speak('en');
		expect(viewName({ name: 'Graphique', type: 'chart' })).toBe('Chart');
	});

	it('keeps a name the user gave, or another type’s default', () => {
		speak('fr');
		expect(viewName({ name: 'Volume par semaine', type: 'chart' })).toBe('Volume par semaine');
		expect(viewName({ name: 'Grid', type: 'list' })).toBe('Grid');
		expect(viewName({ name: 'Grid two', type: 'grid' })).toBe('Grid two');
	});
});
