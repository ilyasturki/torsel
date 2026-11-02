<script lang="ts">
	import { DropdownMenu } from 'bits-ui';
	import type { Snippet } from 'svelte';

	import Icon, { type IconName } from './Icon.svelte';
	import { menuItem, popup } from './styles.ts';

	let {
		label,
		icon,
		disabled = false,
		children
	}: { label: string; icon?: IconName; disabled?: boolean; children: Snippet } = $props();
</script>

<DropdownMenu.Sub>
	<DropdownMenu.SubTrigger class="{menuItem} data-[state=open]:bg-tint" {disabled}>
		{#if icon}<Icon name={icon} class="size-4 text-ink-2" />{/if}
		<span class="min-w-0 flex-1 truncate">{label}</span>
		<Icon name="chevron" class="size-3 text-ink-3" />
	</DropdownMenu.SubTrigger>
	<DropdownMenu.Portal>
		<DropdownMenu.SubContent
			sideOffset={4}
			collisionPadding={8}
			class="{popup} flex min-w-48 enter flex-col"
		>
			{@render children()}
		</DropdownMenu.SubContent>
	</DropdownMenu.Portal>
</DropdownMenu.Sub>
