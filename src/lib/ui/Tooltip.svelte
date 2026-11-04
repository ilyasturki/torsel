<script lang="ts">
	import { Tooltip } from 'bits-ui';
	import type { Snippet } from 'svelte';

	let {
		text,
		shortcut,
		side = 'bottom',
		disabled = false,
		open = $bindable(false),
		children
	}: {
		text?: string;
		shortcut?: string;
		side?: 'top' | 'right' | 'bottom' | 'left';
		/** True while what the trigger opened covers the tooltip's place. */
		disabled?: boolean;
		open?: boolean;
		children: Snippet<[Record<string, unknown>]>;
	} = $props();
</script>

<Tooltip.Root bind:open {disabled}>
	<Tooltip.Trigger>
		{#snippet child({ props })}
			{@render children(props)}
		{/snippet}
	</Tooltip.Trigger>
	<Tooltip.Portal>
		{#if text || shortcut}
			<Tooltip.Content
				{side}
				role="tooltip"
				sideOffset={6}
				collisionPadding={8}
				class="z-50 flex enter gap-2 rounded-box bg-fill px-2 py-1 text-sm font-medium text-on-fill shadow-float"
			>
				{#if text}<span>{text}</span>{/if}
				{#if shortcut}<kbd class="font-sans text-ink-3">{shortcut}</kbd>{/if}
			</Tooltip.Content>
		{/if}
	</Tooltip.Portal>
</Tooltip.Root>
