<script lang="ts">
	import type { Snippet } from 'svelte';

	let { label, hint, children }: { label: string; hint?: string; children: Snippet } = $props();
</script>

<!-- svelte-ignore a11y_label_has_associated_control -->
<label class="flex flex-col gap-1.5">
	<span class="text-[13px] font-medium text-ink-muted">{label}</span>
	{@render children()}
	{#if hint}
		<span class="text-xs text-ink-faint">{hint}</span>
	{/if}
</label>
