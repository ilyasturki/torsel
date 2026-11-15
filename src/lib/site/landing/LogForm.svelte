<script lang="ts">
	import { onMount } from 'svelte';

	import { siteCopy } from '#lib/i18n/site.ts';

	import type { Samples } from './samples.svelte.ts';

	let { samples, locale = 'en' }: { samples: Samples; locale?: 'en' | 'fr' } = $props();
	const t = $derived(siteCopy[locale]);
	const entry = $derived(samples.views.find((view) => view.type === 'entry')?.id);

	onMount(() => {
		void samples.load();
	});
</script>

<section
	class="grid items-center gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
	aria-labelledby="landing-form"
	onpointerenter={(event) => {
		if (event.pointerType === 'mouse') void samples.warm();
	}}
	onpointerdown={() => void samples.warm()}
	onfocusin={() => void samples.warm()}
>
	<div class="grid gap-3 px-4 lg:px-8">
		<h2 id="landing-form" class="text-h2 leading-tight font-semibold tighter text-balance">
			{t.formTitle}
		</h2>
		<p class="max-w-md text-lg text-ink-2">{t.formLead}</p>
	</div>
	<div
		class="h-stage-narrow min-w-0 overflow-hidden rounded-panel bg-glass-strong text-base shadow-raised backdrop-blur-glass"
		data-testid="form"
	>
		{#if samples.View !== null && samples.sample !== undefined && entry !== undefined}
			<samples.View tableId={samples.sample.table} viewId={entry} />
		{/if}
	</div>
</section>
