<script lang="ts">
	import { goto } from '$app/navigation';

	import { app } from '#lib/client/app.svelte.ts';
	import { gridJump } from '#lib/client/grid.svelte.ts';
	import { HOME, SETTINGS } from '#lib/client/nav.ts';
	import { download, shell } from '#lib/client/shell.svelte.ts';
	import { showToast } from '#lib/client/toast.svelte.ts';
	import { deleteRecords } from '#lib/core/actions.ts';
	import { toCsv } from '#lib/core/csv.ts';
	import type { TableDef, ViewDef } from '#lib/core/model.ts';
	import Button from '#lib/ui/Button.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import { wide } from '#lib/ui/media.svelte.ts';
	import Menu from '#lib/ui/Menu.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import MenuSeparator from '#lib/ui/MenuSeparator.svelte';
	import MenuSub from '#lib/ui/MenuSub.svelte';

	import { viewCells } from './grid.ts';
	import { VIEW_TYPES, addView } from './views.ts';

	let {
		open = $bindable(false),
		anchor = null,
		table,
		view,
		onviewsettings
	}: {
		open?: boolean;
		anchor?: HTMLElement | null;
		table: TableDef;
		view?: ViewDef;
		onviewsettings?: () => void;
	} = $props();

	let renaming = false;

	function run(action: () => void): void {
		open = false;
		action();
	}

	const importHere = (): void => {
		shell.importing = { into: table.id };
	};

	function rename(): void {
		renaming = true;
		open = false;
		shell.renamingTable = table.id;
	}

	// The rename input took the focus as the menu closed: handing it back to "…" would close it.
	function keepRenameFocus(event: Event): void {
		if (renaming) event.preventDefault();
		renaming = false;
	}

	function exportHere(): void {
		if (view === undefined) return;
		const cells = viewCells(app.ws, table.id, view, app.computed(table.id));
		// A byte-order mark is how Excel knows the file is UTF-8.
		download(
			`${table.name.replace(/[\\/:*?"<>|]/gu, '-')}.csv`,
			`\uFEFF${toCsv(cells)}`,
			'text/csv'
		);
	}

	const fitAll = (): void => {
		gridJump.fitAll += 1;
	};

	function remove(): void {
		const label = `Table "${table.name}" deleted`;
		const group = app.apply(deleteRecords(app.ws, [table.id]), label);
		showToast(label, group?.id ?? null);
		open = false;
		void goto(HOME);
	}
</script>

{#if wide.current}
	<Menu bind:open {anchor} label={table.name} align="end" onCloseAutoFocus={keepRenameFocus}>
		{#if onviewsettings !== undefined}
			<MenuItem icon="eye" onSelect={() => run(onviewsettings)}>View settings</MenuItem>
		{/if}
		<MenuSub icon="plus" label="New view">
			{#each VIEW_TYPES as option (option.id)}
				<MenuItem icon={option.icon} onSelect={() => run(() => addView(table.id, option.id))}
					>{option.label}</MenuItem
				>
			{/each}
		</MenuSub>
		<MenuItem icon="pencil" onSelect={rename}>Rename table</MenuItem>
		{#if view?.type === 'grid'}
			<MenuItem icon="fit" onSelect={() => run(fitAll)}>Fit all columns</MenuItem>
		{/if}
		<MenuSeparator />
		<MenuItem icon="arrow-down" onSelect={() => run(importHere)}>Import into this table</MenuItem>
		{#if view !== undefined}
			<MenuItem icon="arrow-up" onSelect={() => run(exportHere)}>Export as CSV</MenuItem>
		{/if}
		<MenuSeparator />
		<MenuItem icon="x" onSelect={remove}>Delete table</MenuItem>
	</Menu>
{:else}
	<Dialog bind:open title={table.name} onCloseAutoFocus={keepRenameFocus}>
		<div class="-mx-2 flex flex-col items-stretch">
			{#if onviewsettings !== undefined}
				<Button variant="ghost" class="justify-start" onclick={() => run(onviewsettings)}
					>View settings</Button
				>
			{/if}
			<span class="px-3 pt-2 text-sm text-ink-3" id="new-view">New view</span>
			<div class="grid grid-cols-4 gap-1 px-1 pb-1" role="group" aria-labelledby="new-view">
				{#each VIEW_TYPES as option (option.id)}
					<Button
						class="flex-col gap-1 py-2"
						aria-label="New {option.label.toLowerCase()} view"
						onclick={() => run(() => addView(table.id, option.id))}
					>
						<Icon name={option.icon} />
						<span class="text-sm">{option.label}</span>
					</Button>
				{/each}
			</div>
			<Button variant="ghost" class="justify-start" onclick={rename}>Rename table</Button>
			{#if view?.type === 'grid'}
				<Button variant="ghost" class="justify-start" onclick={() => run(fitAll)}
					>Fit all columns</Button
				>
			{/if}
			<Button variant="ghost" class="justify-start" onclick={() => run(importHere)}
				>Import into this table</Button
			>
			{#if view !== undefined}
				<Button variant="ghost" class="justify-start" onclick={() => run(exportHere)}
					>Export as CSV</Button
				>
			{/if}
			<a
				href={SETTINGS}
				class="inline-flex h-control items-center rounded-box px-3 font-medium text-ink-2 transition-colors motion hover:bg-tint hover:text-ink"
				onclick={() => (open = false)}>Settings</a
			>
			<Button variant="ghost" class="justify-start" onclick={remove}>Delete table</Button>
		</div>
	</Dialog>
{/if}
