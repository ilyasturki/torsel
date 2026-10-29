<script lang="ts">
	import { chipStyle } from './colors.ts';

	let { name, color = null }: { name: string; color?: string | null } = $props();
</script>

<span
	class="inline-flex max-w-full items-center truncate rounded-full px-2 py-0.5 text-[13px] leading-5 font-medium"
	style={chipStyle(color)}>{name}</span
>
