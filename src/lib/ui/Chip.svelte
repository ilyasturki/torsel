<script lang="ts">
	import { swatch } from './colors.ts';

	let { name, color = null }: { name: string; color?: string | null } = $props();
</script>

<span class="inline-flex max-w-full min-w-0 items-center gap-2">
	<span class="size-mark shrink-0 rounded-box" style={swatch(color)}></span>
	<span class="truncate">{name}</span>
</span>
