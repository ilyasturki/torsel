<script lang="ts">
	import type { Snippet } from 'svelte';

	let { label, hint, children }: { label: string; hint?: string; children: Snippet } = $props();
</script>

<!-- svelte-ignore a11y_label_has_associated_control -->
<label class="flex flex-col gap-1">
	<span class="text-sm font-medium text-ink-2">{label}</span>
	{@render children()}
	{#if hint}
		<span class="text-sm text-ink-3">{hint}</span>
	{/if}
</label>
