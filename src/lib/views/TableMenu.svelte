<script lang="ts">
	import { goto } from '$app/navigation';

	import { app } from '#lib/client/app.svelte.ts';
	import { HOME, SETTINGS } from '#lib/client/nav.ts';
	import { shell } from '#lib/client/shell.svelte.ts';
	import { showToast } from '#lib/client/toast.svelte.ts';
	import { deleteRecords } from '#lib/core/actions.ts';
	import type { TableDef } from '#lib/core/model.ts';
	import Button from '#lib/ui/Button.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import { wide } from '#lib/ui/media.svelte.ts';
	import Menu from '#lib/ui/Menu.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import MenuSeparator from '#lib/ui/MenuSeparator.svelte';

	let {
		open = $bindable(false),
		anchor = null,
		table,
		onviewsettings,
		onnewview
	}: {
		open?: boolean;
		anchor?: HTMLElement | null;
		table: TableDef;
		onviewsettings?: () => void;
		onnewview: () => void;
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
		<MenuItem icon="plus" onSelect={() => run(onnewview)}>New view</MenuItem>
		<MenuItem icon="text" onSelect={rename}>Rename table</MenuItem>
		<MenuItem icon="arrow-down" onSelect={() => run(importHere)}>Import into this table</MenuItem>
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
			<Button variant="ghost" class="justify-start" onclick={() => run(onnewview)}>New view</Button>
			<Button variant="ghost" class="justify-start" onclick={rename}>Rename table</Button>
			<Button variant="ghost" class="justify-start" onclick={() => run(importHere)}
				>Import into this table</Button
			>
			<a
				href={SETTINGS}
				class="inline-flex h-control items-center rounded-box px-3 font-medium text-ink-2 transition-colors motion hover:bg-tint hover:text-ink"
				onclick={() => (open = false)}>Settings</a
			>
			<Button variant="ghost" class="justify-start" onclick={remove}>Delete table</Button>
		</div>
	</Dialog>
{/if}
