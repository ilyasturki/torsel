<script lang="ts">
	import type { Snippet } from 'svelte';

	let { text, children }: { text: string; children?: Snippet } = $props();
</script>

<div class="flex flex-col items-start gap-3 p-4">
	<p class="text-ink-2">{text}</p>
	{#if children}
		<div class="flex flex-wrap gap-2">
			{@render children()}
		</div>
	{/if}
</div>
