import { describe, expect, it } from 'vitest';

import { chartSetup, createBase } from '#lib/core/actions.ts';
import { chartData } from '#lib/core/chart.ts';
import { Hlc } from '#lib/core/clock.ts';
import { openEngine } from '#lib/core/engine.ts';
import type { Change } from '#lib/core/model.ts';
import { materializeTable } from '#lib/core/sql.ts';
import { Workspace } from '#lib/core/workspace.ts';

import { POSTER_WORDS } from './examples.ts';
import { POSTER_WORDS_FR } from './examples-fr.ts';
import { earlyChart, seedPosters } from './poster-seed.ts';
import { posters } from './posters.ts';

describe('the landing posters', () => {
	for (const [locale, words] of [
		['en', POSTER_WORDS],
		['fr', POSTER_WORDS_FR]
	] as const) {
		// A Sunday and a Monday, so a week bucket starts on the day itself and on the day before.
		for (const today of [new Date(2026, 10, 15), new Date(2026, 10, 16)]) {
			it(`draw before SQLite what SQLite returns (${locale}, ${today.getDay()})`, async () => {
				const ws = new Workspace();
				const hlc = new Hlc('a');
				const apply = (changes: Change[]): void => {
					for (const change of changes) ws.stamp(change, hlc.tick());
				};
				const base = createBase(ws, 'Sample');
				apply(base.changes);
				const list = posters(today, words);
				const placed = seedPosters(ws, apply, base.id, list);
				const engine = await openEngine();
				for (const poster of list) {
					const early = earlyChart(poster);
					if (early === null) continue;
					const { table, view } = placed[poster.id];
					materializeTable(engine, ws, table);
					const config = chartSetup(ws.fields(table), ws.view(view)?.config ?? {});
					const real = chartData(engine, ws, table, config);
					expect(real?.points.length).toBeGreaterThan(5);
					expect(early.series).toEqual(real?.series);
					expect(early.points.map(({ x, series }) => [x, series])).toEqual(
						real?.points.map(({ x, series }) => [x, series])
					);
					early.points.forEach((point, at) =>
						expect(point.y).toBeCloseTo(real?.points[at].y ?? NaN, 9)
					);
					expect({ ...early, points: [] }).toEqual({ ...real, points: [] });
				}
			});
		}
	}
});
