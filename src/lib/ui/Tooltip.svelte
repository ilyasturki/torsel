<script lang="ts">
	import { Tooltip } from 'bits-ui';
	import type { Snippet } from 'svelte';

	let {
		text,
		side = 'bottom',
		open = $bindable(false),
		children
	}: {
		text: string;
		side?: 'top' | 'right' | 'bottom' | 'left';
		open?: boolean;
		children: Snippet<[Record<string, unknown>]>;
	} = $props();
</script>

<Tooltip.Root bind:open>
	<Tooltip.Trigger>
		{#snippet child({ props })}
			{@render children(props)}
		{/snippet}
	</Tooltip.Trigger>
	<Tooltip.Portal>
		<Tooltip.Content
			{side}
			sideOffset={6}
			collisionPadding={8}
			class="z-50 enter rounded-box bg-fill px-2 py-1 text-sm font-medium text-on-fill shadow-float"
		>
			{text}
		</Tooltip.Content>
	</Tooltip.Portal>
</Tooltip.Root>
