<script lang="ts">
	import { DropdownMenu } from 'bits-ui';
	import type { Snippet } from 'svelte';

	import Icon, { type IconName } from './Icon.svelte';
	import { menuItem } from './styles.ts';

	let {
		icon,
		shortcut,
		checked = false,
		disabled = false,
		onSelect,
		children
	}: {
		icon?: IconName;
		shortcut?: string;
		checked?: boolean;
		disabled?: boolean;
		onSelect?: (event: Event) => void;
		children: Snippet;
	} = $props();
</script>

<DropdownMenu.Item class={menuItem} {disabled} {onSelect}>
	{#if icon}<Icon name={icon} class="size-4 text-ink-2" />{/if}
	<span class="min-w-0 flex-1 truncate">{@render children()}</span>
	{#if shortcut}<kbd class="font-sans text-sm text-ink-3">{shortcut}</kbd>{/if}
	{#if checked}<Icon name="check" label="Current" class="size-4 text-ink-2" />{/if}
</DropdownMenu.Item>
