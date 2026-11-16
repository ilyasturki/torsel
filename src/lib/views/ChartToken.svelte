<script lang="ts">
	import Dialog from '#lib/ui/Dialog.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import { wide } from '#lib/ui/media.svelte.ts';
	import Menu from '#lib/ui/Menu.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import { menuItem, token } from '#lib/ui/styles.ts';

	let {
		open = $bindable(false),
		label,
		text,
		options,
		value,
		onpick
	}: {
		open?: boolean;
		/** What the menu sets, for a screen reader and the phone sheet's title. */
		label: string;
		text: string;
		options: { value: string; label: string }[];
		value: string;
		onpick: (value: string) => void;
	} = $props();
</script>

{#snippet face()}
	<span class="max-w-48 truncate">{text}</span>
	<Icon name="chevron" class="size-3 rotate-90 text-ink-3" />
{/snippet}

{#if wide.current}
	<Menu bind:open {label}>
		{#snippet trigger(props)}
			<button type="button" {...props} class={token} aria-label="{label}: {text}">
				{@render face()}
			</button>
		{/snippet}
		{#each options as option (option.value)}
			<MenuItem checked={option.value === value} onSelect={() => onpick(option.value)}
				>{option.label}</MenuItem
			>
		{/each}
	</Menu>
{:else}
	<button type="button" class={token} aria-label="{label}: {text}" onclick={() => (open = true)}>
		{@render face()}
	</button>
	<Dialog bind:open title={label} typeOnOpen={false}>
		<div class="flex flex-col" role="listbox" aria-label={label}>
			{#each options as option (option.value)}
				<button
					type="button"
					role="option"
					aria-selected={option.value === value}
					class="{menuItem} h-cta hover:bg-tint-2"
					onclick={() => {
						onpick(option.value);
						open = false;
					}}
				>
					<span class="min-w-0 flex-1 truncate text-left">{option.label}</span>
					{#if option.value === value}<Icon name="check" class="size-4 text-ink-2" />{/if}
				</button>
			{/each}
		</div>
	</Dialog>
{/if}
