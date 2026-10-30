import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SOURCES = ['src/lib', 'src/routes'];

function files(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return files(path);
		return /\.(svelte|ts)$/u.test(entry.name) && !entry.name.endsWith('.test.ts') ? [path] : [];
	});
}

const CHECKS: [string, RegExp][] = [
	[
		'a radius outside the tokens',
		/\brounded(?!-box\b|-panel\b|-none\b)(?:-[a-z0-9]+)*\b(?=[\s'"`:}])/u
	],
	['a shadow outside the tokens', /\bshadow(?!-raised\b|-float\b|-none\b)-[a-z0-9]+/u],
	['an arbitrary size', /[\s'"`:](?:[a-z-]+-)?\[\d[^\]]*(?:px|rem|em|dvh|vh|%)\]/u],
	['a stylesheet of its own', /<style[\s>]/u],
	['a font or icon set the design ruled out', /fontsource-variable\/geist|@lucide\/|font-serif/u]
];

describe('design tokens', () => {
	const sources = SOURCES.flatMap(files).map((path) => ({
		path,
		text: readFileSync(path, 'utf8')
	}));

	it.each(CHECKS)('no view uses %s', (_, pattern) => {
		expect(sources.filter(({ text }) => pattern.test(text)).map(({ path }) => path)).toEqual([]);
	});

	it('finds the views it checks', () => {
		expect(sources.length).toBeGreaterThan(20);
	});
});
