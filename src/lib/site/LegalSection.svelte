<script lang="ts">
	import type { Snippet } from 'svelte';

	let { title, children }: { title: string; children: Snippet } = $props();
</script>

<section class="flex flex-col gap-2">
	<h2 class="text-xl font-semibold tight">{title}</h2>
	<div class="flex flex-col gap-3 text-lg text-ink-2">
		{@render children()}
	</div>
</section>
