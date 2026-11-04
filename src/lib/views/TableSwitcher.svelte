<script lang="ts">
	import { Popover } from 'bits-ui';

	import { goto } from '$app/navigation';

	import { app } from '#lib/client/app.svelte.ts';
	import { HOME, tableUrl } from '#lib/client/nav.ts';
	import { shell, startTable } from '#lib/client/shell.svelte.ts';
	import Icon from '#lib/ui/Icon.svelte';
	import { keys } from '#lib/ui/keys.ts';
	import { focus, input } from '#lib/ui/styles.ts';
	import Tooltip from '#lib/ui/Tooltip.svelte';

	let { name, current }: { name: string; current: string | null } = $props();

	// As in GridPicker: past this many tables a search earns the phone keyboard's space.
	const NO_KEYBOARD = 12;

	type Item = { key: string; label: string; count?: number; go: () => void };

	let query = $state('');
	let active = $state(0);
	let list = $state<HTMLElement>();
	let picked = false;

	const tables = $derived.by(() => {
		void app.version;
		return app.ws.bases().flatMap((base) =>
			app.ws.tables(base.id).map((table) => ({
				id: table.id,
				label: table.name,
				count: app.ws.rows(table.id).length
			}))
		);
	});

	const needle = $derived(query.trim().toLowerCase());

	const items = $derived<Item[]>([
		...tables
			.filter((table) => needle === '' || table.label.toLowerCase().includes(needle))
			.map((table) => ({
				key: table.id,
				label: table.label,
				count: table.count,
				go: () => void goto(tableUrl(table.id))
			})),
		{ key: 'all', label: 'All tables', go: () => void goto(HOME) },
		{ key: 'new', label: 'New table', go: () => startTable() }
	]);

	$effect(() => {
		void needle;
		active =
			needle === ''
				? Math.max(
						0,
						tables.findIndex((table) => table.id === current)
					)
				: 0;
	});

	$effect(() => {
		list?.children[active]?.scrollIntoView({ block: 'nearest' });
	});

	function pick(item: Item | undefined): void {
		picked = true;
		shell.switching = false;
		query = '';
		item?.go();
	}

	function onkeydown(event: KeyboardEvent): void {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			const step = event.key === 'ArrowDown' ? 1 : -1;
			active = Math.min(items.length - 1, Math.max(0, active + step));
		} else if (event.key === 'Enter') {
			event.preventDefault();
			pick(items.at(active));
		}
	}

	// Escape closes the list only, wherever the focus is: the Ask panel listens for it on the window too.
	function onescape(event: KeyboardEvent): void {
		if (shell.switching && event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			shell.switching = false;
		}
	}
</script>

<svelte:window onkeydowncapture={onescape} />

<Popover.Root
	bind:open={shell.switching}
	onOpenChange={(open) => {
		if (!open) query = '';
	}}
>
	<Tooltip text="Jump to a table" shortcut={keys('mod', 'p')}>
		{#snippet children(props)}
			<Popover.Trigger
				{...props}
				class="-mx-1.5 flex h-control min-w-0 items-center gap-1 rounded-box px-1.5 font-semibold transition-colors motion hover:bg-tint aria-expanded:bg-tint {focus}"
			>
				<span class="truncate">{name}</span>
				<Icon name="chevron-down" class="size-3 shrink-0 text-ink-3" />
			</Popover.Trigger>
		{/snippet}
	</Tooltip>
	<Popover.Portal>
		<Popover.Content
			side="bottom"
			align="start"
			sideOffset={4}
			collisionPadding={8}
			onCloseAutoFocus={(event) => {
				// A pick moves on, often to a field that takes focus: only Escape returns to the name.
				if (picked) event.preventDefault();
				picked = false;
			}}
			class="z-40 flex w-72 max-w-full flex-col gap-1 rounded-panel bg-float p-1 shadow-float outline-none"
		>
			<input
				bind:value={query}
				class={input}
				role="combobox"
				aria-label="Jump to a table"
				aria-expanded="true"
				aria-autocomplete="list"
				aria-controls="table-switcher"
				aria-activedescendant="table-switcher-{active}"
				placeholder="Jump to a table"
				autocomplete="off"
				inputmode={tables.length <= NO_KEYBOARD ? 'none' : undefined}
				{onkeydown}
			/>
			<div
				bind:this={list}
				id="table-switcher"
				role="listbox"
				aria-label="Tables"
				tabindex="-1"
				class="flex max-h-80 flex-col overflow-y-auto"
				onmousedown={(event) => event.preventDefault()}
			>
				{#each items as item, index (item.key)}
					<button
						type="button"
						id="table-switcher-{index}"
						role="option"
						aria-label={item.label}
						aria-selected={index === active}
						tabindex="-1"
						class="flex h-control w-full min-w-0 shrink-0 items-center gap-2 rounded-box px-2 text-left {index ===
						active
							? 'bg-tint-2'
							: 'hover:bg-tint'} {item.count === undefined ? 'text-ink-2' : ''} {item.key === 'all'
							? 'mt-1 border-t border-hair'
							: ''}"
						onclick={() => pick(item)}
					>
						<span class="flex size-4 shrink-0 items-center justify-center">
							{#if item.key === current}
								<Icon name="check" class="size-3.5" />
							{:else if item.key === 'new'}
								<Icon name="plus" class="size-3.5" />
							{/if}
						</span>
						<span class="min-w-0 flex-1 truncate">{item.label}</span>
						{#if item.count !== undefined}
							<span class="shrink-0 text-sm text-ink-3">{item.count}</span>
						{/if}
					</button>
				{/each}
			</div>
		</Popover.Content>
	</Popover.Portal>
</Popover.Root>
