<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		name,
		from,
		children
	}: {
		/** The component's name in the code, which is also its anchor. */
		name: string;
		/** Where it lives, from `src/lib`. */
		from?: string;
		children: Snippet;
	} = $props();

	const id = $derived(name.toLowerCase().replaceAll(' ', '-'));
</script>

<section {id} class="flex scroll-mt-6 flex-col gap-4 py-8">
	<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
		<h2 class="text-lg font-semibold tight">
			<a href="#{id}" class="hover:underline">{name}</a>
		</h2>
		{#if from}<span class="font-mono text-xs text-ink-3">{from}</span>{/if}
	</div>
	<div class="flex flex-wrap items-start gap-x-8 gap-y-6">
		{@render children()}
	</div>
</section>
