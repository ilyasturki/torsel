<script lang="ts">
	import { DropdownMenu } from 'bits-ui';
	import type { Snippet } from 'svelte';

	import { popup } from './styles.ts';

	let {
		open = $bindable(false),
		anchor = null,
		label,
		side = 'bottom',
		align = 'start',
		trigger,
		onCloseAutoFocus,
		children
	}: {
		/** Where focus goes once it closes; `preventDefault` keeps it where an item put it. */
		onCloseAutoFocus?: (event: Event) => void;
		open?: boolean;
		/** Without `trigger`: the element the menu hangs from, which keeps its own click handler. */
		anchor?: HTMLElement | null;
		label?: string;
		side?: 'top' | 'right' | 'bottom' | 'left';
		align?: 'start' | 'center' | 'end';
		trigger?: Snippet<[Record<string, unknown>]>;
		children: Snippet;
	} = $props();
</script>

<DropdownMenu.Root bind:open>
	{#if trigger}
		<DropdownMenu.Trigger>
			{#snippet child({ props })}
				{@render trigger(props)}
			{/snippet}
		</DropdownMenu.Trigger>
	{/if}
	<DropdownMenu.Portal>
		<DropdownMenu.Content
			customAnchor={trigger ? undefined : anchor}
			aria-label={label}
			{side}
			{align}
			sideOffset={4}
			collisionPadding={8}
			class="{popup} flex min-w-48 enter flex-col"
			onInteractOutside={(event) => {
				if (anchor !== null && event.target instanceof Node && anchor.contains(event.target)) {
					event.preventDefault();
				}
			}}
			onCloseAutoFocus={(event) => {
				onCloseAutoFocus?.(event);
				if (!event.defaultPrevented && !trigger && anchor !== null) {
					event.preventDefault();
					anchor.focus();
				}
			}}
		>
			{@render children()}
		</DropdownMenu.Content>
	</DropdownMenu.Portal>
</DropdownMenu.Root>
