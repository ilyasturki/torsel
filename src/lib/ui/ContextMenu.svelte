<script lang="ts">
	import { ContextMenu } from 'bits-ui';
	import type { Snippet } from 'svelte';

	import { popup } from './styles.ts';

	let {
		open = $bindable(false),
		label,
		target,
		children
	}: {
		open?: boolean;
		label?: string;
		/** The region a right-click (or a long press) opens the menu on. */
		target: Snippet<[Record<string, unknown>]>;
		children: Snippet;
	} = $props();
</script>

<ContextMenu.Root bind:open>
	<ContextMenu.Trigger>
		{#snippet child({ props })}
			{@render target(props)}
		{/snippet}
	</ContextMenu.Trigger>
	<ContextMenu.Portal>
		<ContextMenu.Content
			aria-label={label}
			collisionPadding={8}
			class="{popup} flex min-w-48 enter flex-col"
		>
			{@render children()}
		</ContextMenu.Content>
	</ContextMenu.Portal>
</ContextMenu.Root>
