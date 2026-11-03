<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		label,
		wide = false,
		children
	}: {
		/** The state or the props that make this specimen, as written. */
		label: string;
		/** Takes the section's whole width: a grid, a view, a row of swatches. */
		wide?: boolean;
		children: Snippet;
	} = $props();
</script>

<figure class="m-0 flex flex-col items-start gap-2 {wide ? 'w-full' : 'min-w-0'}">
	{@render children()}
	<figcaption class="font-mono text-xs text-ink-3">{label}</figcaption>
</figure>
