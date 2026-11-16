<script lang="ts">
	import type { Snippet } from 'svelte';

	import { LEGAL_UPDATED } from '../site.ts';

	let {
		title,
		updated,
		locale,
		children
	}: { title: string; updated: string; locale: string; children: Snippet } = $props();

	const date = $derived(
		new Date(`${LEGAL_UPDATED}T12:00:00Z`).toLocaleDateString(locale, {
			dateStyle: 'long',
			timeZone: 'UTC'
		})
	);
</script>

<article class="flex flex-col gap-8 rounded-panel bg-raised p-5 shadow-raised lg:px-16 lg:py-14">
	<header class="flex max-w-prose flex-col gap-2">
		<h1 class="text-2xl leading-none font-semibold tighter lg:text-hero">{title}</h1>
		<p class="text-ink-3">{updated} {date}</p>
	</header>
	{@render children()}
</article>
