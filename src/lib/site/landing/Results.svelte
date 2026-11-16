<script lang="ts">
	import { onMount } from 'svelte';

	import { site as t } from '#lib/i18n/site.ts';

	import type { PosterId } from './posters.ts';
	import type { Samples } from './samples.svelte.ts';

	let { samples }: { samples: Samples } = $props();

	const counts: Record<PosterId, (count: number) => string> = {
		weight: (count) => t.weighIns(count),
		lifting: (count) => t.sets(count),
		movies: (count) => t.movies(count)
	};

	const rows = (table: string): number | null => {
		const live = samples.live;
		if (live === null) return null;
		void live.app.version;
		return live.app.ws.rows(table).length;
	};

	let section = $state<HTMLElement>();
	// Two screens below the first, the posters draw once the page nears them, not with it.
	let near = $state(false);

	onMount(() => {
		void samples.load();
		if (section === undefined) return;
		const seen = new IntersectionObserver(
			([entry]) => {
				if (entry?.isIntersecting !== true) return;
				near = true;
				seen.disconnect();
			},
			{ rootMargin: '50% 0px' }
		);
		seen.observe(section);
		return () => seen.disconnect();
	});
</script>

<section
	bind:this={section}
	class="grid grid-cols-1 gap-6"
	aria-labelledby="landing-keep"
	data-testid="posters"
>
	<h2
		id="landing-keep"
		class="px-3 text-h2 leading-tight font-semibold tighter text-balance lg:px-5"
	>
		{t.keepTitle}
	</h2>
	<div class="grid grid-cols-1 gap-2 max-lg:gap-1.5 lg:grid-cols-3">
		{#each samples.posterList as poster (poster.id)}
			{@const placed = samples.posters?.[poster.id]}
			{@const count = placed === undefined ? null : rows(placed.table)}
			<figure
				class="m-0 grid grid-rows-[1fr_auto] overflow-clip rounded-panel bg-glass shadow-raised backdrop-blur-glass"
				data-testid="poster"
			>
				<div class="h-poster overflow-clip bg-glass-strong text-base" inert>
					{#if near && samples.View !== null && placed !== undefined}
						<samples.View tableId={placed.table} viewId={placed.view} />
					{/if}
				</div>
				<figcaption class="flex justify-between gap-4 px-4 py-3">
					<span class="font-semibold">{poster.table}</span>
					<span class="text-ink-2">{counts[poster.id](count ?? poster.rows.length)}</span>
				</figcaption>
			</figure>
		{/each}
	</div>
</section>
