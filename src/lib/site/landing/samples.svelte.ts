import type { Component } from 'svelte';

import type { ViewDef } from '#lib/core/model.ts';

import { EXAMPLES, POSTER_WORDS, type Example } from './examples.ts';
import { EXAMPLES_FR, POSTER_WORDS_FR } from './examples-fr.ts';
import type { Placed } from './poster-seed.ts';
import { posters, type Poster, type PosterId } from './posters.ts';
import type { Sample } from './seed.ts';

export type Live = typeof import('./live.ts');
type ViewComponent = Component<{ tableId: string; viewId: string | undefined }>;
type Seeded = (live: Live, tables: Record<string, Sample>) => void;

/** The sample tables every section of the landing shows: one workspace in memory, SQLite held back until wanted. */
export class Samples {
	public readonly examples: Example[];
	public example: Example = $state() as Example;
	public live = $state<Live | null>(null);
	public tables = $state<Record<string, Sample> | null>(null);
	public readonly posterList: Poster[];
	public posters = $state<Record<PosterId, Placed> | null>(null);
	public View = $state<ViewComponent | null>(null);
	public Toast = $state<Component | null>(null);

	private openEngine: () => void = () => undefined;
	private readonly engineWanted = new Promise<void>((resolve) => (this.openEngine = resolve));
	private loading: Promise<void> | undefined;
	private readonly seeded: Seeded[] = [];

	public constructor(locale: 'en' | 'fr') {
		this.examples = locale === 'fr' ? EXAMPLES_FR : EXAMPLES;
		this.example = this.examples[0];
		this.posterList = posters(new Date(), locale === 'fr' ? POSTER_WORDS_FR : POSTER_WORDS);
	}

	public readonly sample = $derived(this.tables?.[this.example.id]);

	public readonly views = $derived.by((): ViewDef[] => {
		if (this.sample === undefined || this.live === null) return [];
		void this.live.app.version;
		return this.live.app.ws.views(this.sample.table);
	});

	public readonly rowCount = $derived.by((): number => {
		if (this.sample === undefined || this.live === null) return this.example.rows.length;
		void this.live.app.version;
		return this.live.app.ws.rows(this.sample.table).length;
	});

	/** Runs `then` on the tables as they are made, before any section draws them. */
	public load(then?: Seeded): Promise<void> {
		if (then !== undefined) this.seeded.push(then);
		this.loading ??= Promise.all([
			import('./live.ts').then((live) => {
				let made: Record<string, Sample> | null = null;
				let placed: Record<PosterId, Placed> | null = null;
				const narrow = matchMedia('(max-width: 1023px)').matches;
				void live.app.openSample((ws, commit) => {
					made = live.seedExamples(ws, commit, this.examples, narrow);
					placed = live.seedPosterTables(ws, commit, this.posterList);
				}, this.engineWanted);
				if (made !== null) for (const run of this.seeded) run(live, made);
				if (placed !== null) live.showPostersEarly(this.posterList, placed);
				this.tables = made;
				this.posters = placed;
				this.live = live;
			}),
			import('./SampleView.svelte').then((module) => (this.View = module.default)),
			import('#lib/views/Toast.svelte').then((module) => (this.Toast = module.default))
		]).then(() => undefined);
		return this.loading;
	}

	/** SQLite loads on the first sign the visitor means to use a table, not with the page. */
	public warm(): Promise<void> {
		this.openEngine();
		return this.live?.app.load() ?? Promise.resolve();
	}
}
