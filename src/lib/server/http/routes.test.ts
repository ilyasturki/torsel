import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PUBLIC_API_ROUTES } from './public-routes.ts';

const ROOT = 'src/routes/api';

function endpoints(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return endpoints(path);
		return entry.name === '+server.ts' ? [path] : [];
	});
}

const routes = endpoints(ROOT).map((file) => ({
	path: `/api${file.slice(ROOT.length, -'/+server.ts'.length)}`,
	source: readFileSync(file, 'utf8')
}));

const guarded = (source: string) => source.includes('requireCredential(');

describe('api routes', () => {
	it('found the API surface', () => {
		expect(routes.length).toBeGreaterThan(10);
	});

	it('are each guarded or declared public', () => {
		const unclassified = routes
			.filter(({ path, source }) => !guarded(source) && !(path in PUBLIC_API_ROUTES))
			.map(({ path }) => path);

		expect(unclassified).toEqual([]);
	});

	it('are never both guarded and public', () => {
		const contradictory = routes
			.filter(({ path, source }) => guarded(source) && path in PUBLIC_API_ROUTES)
			.map(({ path }) => path);

		expect(contradictory).toEqual([]);
	});

	it('leave no stale entry on the allowlist', () => {
		const known = new Set(routes.map(({ path }) => path));

		expect(Object.keys(PUBLIC_API_ROUTES).filter((path) => !known.has(path))).toEqual([]);
	});
});
