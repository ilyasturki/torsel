<script lang="ts">
	import { Popover } from 'bits-ui';
	import { untrack } from 'svelte';

	import Chip from '#lib/ui/Chip.svelte';

	type PickerOption = { id: string; label: string; color?: string | null };

	let {
		label,
		options,
		value,
		seed,
		creatable,
		onpick,
		onkeep,
		oncancel
	}: {
		label: string;
		options: PickerOption[];
		value: string | null;
		seed: string;
		creatable: boolean;
		onpick: (value: string | null, down: number, right: number) => void;
		onkeep: (down: number, right: number) => void;
		oncancel: () => void;
	} = $props();

	// Filtering narrows a long list: no list a person reads needs more than this at once.
	const SHOWN = 100;
	// As in Entry: past this many options a search earns the phone keyboard's space.
	const NO_KEYBOARD = 12;

	type Item = { key: string; value: string | null; label: string; color?: string | null };

	let query = $state(untrack(() => seed));
	let input = $state<HTMLInputElement>();
	let list = $state<HTMLElement>();

	const needle = $derived(query.trim().toLowerCase());

	const items = $derived.by((): Item[] => {
		const matching = options
			.filter((option) => needle === '' || option.label.toLowerCase().includes(needle))
			.slice(0, SHOWN)
			.map((option) => ({
				key: `option ${option.id}`,
				value: option.id,
				label: option.label,
				color: option.color
			}));
		const clear =
			needle === '' && value !== null ? [{ key: 'clear', value: null, label: 'Clear' }] : [];
		const create =
			creatable && needle !== '' && !options.some((option) => option.label.toLowerCase() === needle)
				? [{ key: 'create', value: query.trim(), label: `Add "${query.trim()}"` }]
				: [];
		return [...clear, ...matching, ...create];
	});

	let active = $state(0);

	$effect(() => {
		void needle;
		active = untrack(() =>
			needle === ''
				? Math.max(
						0,
						items.findIndex((item) => item.value === value)
					)
				: 0
		);
	});

	$effect(() => {
		list?.children[active]?.scrollIntoView({ block: 'nearest' });
	});

	function onkeydown(event: KeyboardEvent): void {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			const step = event.key === 'ArrowDown' ? 1 : -1;
			active = Math.min(items.length - 1, Math.max(0, active + step));
		} else if (event.key === 'Enter') {
			event.preventDefault();
			const item = items.at(active);
			if (item === undefined) oncancel();
			else onpick(item.value, event.shiftKey ? -1 : 1, 0);
		} else if (event.key === 'Tab') {
			event.preventDefault();
			const item = items.at(active);
			const right = event.shiftKey ? -1 : 1;
			if (needle !== '' && item !== undefined) onpick(item.value, 0, right);
			else onkeep(0, right);
		} else if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			oncancel();
		}
	}
</script>

<input
	bind:this={input}
	bind:value={query}
	{@attach (node: HTMLInputElement) => {
		node.focus();
		node.setSelectionRange(node.value.length, node.value.length);
	}}
	class="absolute inset-0 z-1 h-full w-full bg-raised px-3 ring-2 ring-ink outline-none ring-inset"
	role="combobox"
	aria-label={label}
	aria-expanded="true"
	aria-autocomplete="list"
	aria-controls="grid-picker"
	aria-activedescendant="grid-picker-{active}"
	inputmode={options.length <= NO_KEYBOARD ? 'none' : undefined}
	placeholder={options.find((option) => option.id === value)?.label ?? ''}
	{onkeydown}
	onblur={oncancel}
/>

{#if input}
	<Popover.Root open={true}>
		<Popover.Portal>
			<Popover.Content
				customAnchor={input}
				side="bottom"
				align="start"
				sideOffset={2}
				trapFocus={false}
				onOpenAutoFocus={(event) => event.preventDefault()}
				onCloseAutoFocus={(event) => event.preventDefault()}
				onInteractOutside={(event) => event.preventDefault()}
				onEscapeKeydown={(event) => event.preventDefault()}
				class="z-30 w-64 max-w-full rounded-panel bg-float shadow-float outline-none"
			>
				<div
					bind:this={list}
					id="grid-picker"
					role="listbox"
					aria-label={label}
					tabindex="-1"
					class="max-h-64 overflow-y-auto p-1"
					onmousedown={(event) => event.preventDefault()}
				>
					{#each items as item, index (item.key)}
						<button
							type="button"
							id="grid-picker-{index}"
							role="option"
							aria-selected={index === active}
							tabindex="-1"
							class="flex h-control w-full min-w-0 items-center rounded-box px-2 text-left {index ===
							active
								? 'bg-tint-2'
								: 'hover:bg-tint'} {item.value === null ? 'text-ink-3' : ''}"
							onclick={() => onpick(item.value, 0, 0)}
						>
							{#if !item.key.startsWith('option')}
								<span class="truncate">{item.label}</span>
							{:else}
								<Chip name={item.label} color={item.color ?? null} />
							{/if}
						</button>
					{:else}
						<p class="flex h-control items-center px-2 text-ink-3">No match</p>
					{/each}
				</div>
			</Popover.Content>
		</Popover.Portal>
	</Popover.Root>
{/if}
