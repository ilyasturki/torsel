import { describe, expect, it } from 'vitest';

import catalogs from '../i18n/sources.ts';
import { presetFor, presetSource, sheetCsv } from './presets.ts';

const words = catalogs.en;

describe('presets', () => {
	it.each([
		'ilyas',
		'@ilyas',
		'https://letterboxd.com/ilyas/',
		'https://letterboxd.com/ilyas/rss/',
		'letterboxd.com/ilyas'
	])('reads the Letterboxd member in %s', (typed) => {
		expect(presetSource('letterboxd', typed, words)?.url).toBe('https://letterboxd.com/ilyas/rss/');
	});

	it('refuses what is not a member name', () => {
		expect(presetSource('letterboxd', 'not a name', words)).toBeNull();
		expect(presetSource('letterboxd', 'https://evil.example/ilyas', words)).toBeNull();
	});

	it('turns any Google Sheets link into its CSV', () => {
		expect(
			sheetCsv('https://docs.google.com/spreadsheets/d/e/2PACX-1abc/pubhtml?gid=42&single=true')
		).toBe('https://docs.google.com/spreadsheets/d/e/2PACX-1abc/pub?gid=42&single=true&output=csv');
		expect(sheetCsv('https://docs.google.com/spreadsheets/d/1xyz/edit#gid=7')).toBe(
			'https://docs.google.com/spreadsheets/d/1xyz/export?format=csv&gid=7'
		);
		expect(sheetCsv('https://example.com/spreadsheets/d/1xyz/edit')).toBeNull();
	});

	it('knows a pasted link’s preset by its site', () => {
		expect(presetFor('https://letterboxd.com/ilyas/')).toBe('letterboxd');
		expect(presetFor('https://docs.google.com/spreadsheets/d/1xyz/edit#gid=0')).toBe('sheet');
		expect(presetFor('https://docs.google.com/document/d/1xyz/edit')).toBeNull();
		expect(presetFor('https://github.com/sveltejs/kit')).toBe('github');
		expect(presetFor('https://example.com/movies.csv')).toBeNull();
		expect(presetFor('not a link')).toBeNull();
	});

	it('reads a GitHub repository by name or link', () => {
		const made = presetSource('github', 'https://github.com/sveltejs/kit.git', words);
		expect(made?.url).toBe(
			'https://api.github.com/repos/sveltejs/kit/issues?state=all&per_page=100'
		);
		expect(made?.name).toBe('sveltejs/kit issues');
		expect(presetSource('github', 'sveltejs', words)).toBeNull();
	});
});
