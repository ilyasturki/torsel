<script lang="ts">
	import { tag } from './colors.ts';

	let { name, color = null }: { name: string; color?: string | null } = $props();
</script>

<span
	class="inline-flex h-5 max-w-full min-w-0 items-center rounded-box px-1.5 text-sm font-medium"
	style={tag(color)}
>
	<span class="truncate">{name}</span>
</span>
