<script lang="ts">
	import { goto } from '$app/navigation';

	import { app } from '#lib/client/app.svelte.ts';
	import { gridJump } from '#lib/client/grid.svelte.ts';
	import { HOME, SETTINGS, tableUrl } from '#lib/client/nav.ts';
	import { downloadCsv, shell } from '#lib/client/shell.svelte.ts';
	import { applyWithUndo, showToast } from '#lib/client/toast.svelte.ts';
	import { deleteRecords } from '#lib/core/actions.ts';
	import { duplicateTable } from '#lib/core/duplicate.ts';
	import { numberedName } from '#lib/core/names.ts';
	import type { TableDef, ViewDef } from '#lib/core/model.ts';
	import { names } from '#lib/i18n/names.ts';
	import { shell as shellWords } from '#lib/i18n/shell.ts';
	import { table as words } from '#lib/i18n/table.ts';
	import { views as viewWords } from '#lib/i18n/views.ts';
	import Button from '#lib/ui/Button.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import { wide } from '#lib/ui/media.svelte.ts';
	import Menu from '#lib/ui/Menu.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import MenuSeparator from '#lib/ui/MenuSeparator.svelte';
	import MenuSub from '#lib/ui/MenuSub.svelte';

	import { VIEW_TYPES, addView, viewLabel } from './views.ts';

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

	// A table a source fills takes no rows from a file.
	const adds = $derived.by(() => {
		void app.version;
		return app.canAddRows(table.id);
	});

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
		downloadCsv(table.id, view.id);
	}

	const fitAll = (): void => {
		gridJump.fitAll += 1;
	};

	function duplicate(): void {
		const name = numberedName(
			app.ws.tables(table.base).map((other) => other.name),
			names.copy(table.name)
		);
		const made = duplicateTable(app.ws, table.id, name);
		applyWithUndo(made.changes, words.tableDuplicated(name));
		void goto(tableUrl(made.id));
	}

	function remove(): void {
		const label = words.tableDeleted(table.name);
		const group = app.apply(deleteRecords(app.ws, [table.id]), label);
		showToast(label, group?.id ?? null);
		open = false;
		void goto(HOME);
	}
</script>

{#if wide.current}
	<Menu bind:open {anchor} label={table.name} align="end" onCloseAutoFocus={keepRenameFocus}>
		{#if onviewsettings !== undefined}
			<MenuItem icon="settings" onSelect={() => run(onviewsettings)}
				>{viewWords.viewSettings}</MenuItem
			>
		{/if}
		<MenuSub icon="plus" label={viewWords.newView}>
			{#each VIEW_TYPES as option (option.id)}
				<MenuItem icon={option.icon} onSelect={() => run(() => addView(table.id, option.id))}
					>{viewLabel(option.id)}</MenuItem
				>
			{/each}
		</MenuSub>
		<MenuItem icon="pencil" onSelect={rename}>{words.renameTable}</MenuItem>
		<MenuItem icon="plus" onSelect={() => run(duplicate)}>{words.duplicateTable}</MenuItem>
		{#if view?.type === 'grid'}
			<MenuItem icon="fit" onSelect={() => run(fitAll)}>{words.fitAll}</MenuItem>
		{/if}
		<MenuSeparator />
		{#if adds}
			<MenuItem icon="arrow-down" onSelect={() => run(importHere)}>{words.importHere}</MenuItem>
		{/if}
		{#if view !== undefined}
			<MenuItem icon="arrow-up" onSelect={() => run(exportHere)}>{words.exportCsv}</MenuItem>
		{/if}
		<MenuSeparator />
		<MenuItem icon="x" onSelect={remove}>{words.deleteTable}</MenuItem>
	</Menu>
{:else}
	<Dialog bind:open title={table.name} onCloseAutoFocus={keepRenameFocus}>
		<div class="-mx-2 flex flex-col items-stretch">
			{#if onviewsettings !== undefined}
				<Button variant="ghost" class="justify-start" onclick={() => run(onviewsettings)}
					>{viewWords.viewSettings}</Button
				>
			{/if}
			<span class="px-3 pt-2 text-sm text-ink-3" id="new-view">{viewWords.newView}</span>
			<div class="grid grid-cols-4 gap-1 px-1 pb-1" role="group" aria-labelledby="new-view">
				{#each VIEW_TYPES as option (option.id)}
					<Button
						class="flex-col gap-1 py-2"
						aria-label={viewWords.newViewOf(viewLabel(option.id))}
						onclick={() => run(() => addView(table.id, option.id))}
					>
						<Icon name={option.icon} />
						<span class="text-sm">{viewLabel(option.id)}</span>
					</Button>
				{/each}
			</div>
			<Button variant="ghost" class="justify-start" onclick={rename}>{words.renameTable}</Button>
			<Button variant="ghost" class="justify-start" onclick={() => run(duplicate)}
				>{words.duplicateTable}</Button
			>
			{#if view?.type === 'grid'}
				<Button variant="ghost" class="justify-start" onclick={() => run(fitAll)}
					>{words.fitAll}</Button
				>
			{/if}
			{#if adds}
				<Button variant="ghost" class="justify-start" onclick={() => run(importHere)}
					>{words.importHere}</Button
				>
			{/if}
			{#if view !== undefined}
				<Button variant="ghost" class="justify-start" onclick={() => run(exportHere)}
					>{words.exportCsv}</Button
				>
			{/if}
			<a
				href={SETTINGS}
				class="inline-flex h-control items-center rounded-box px-3 font-medium text-ink-2 transition-colors motion hover:bg-tint hover:text-ink"
				onclick={() => (open = false)}>{shellWords.settings}</a
			>
			<Button variant="ghost" class="justify-start" onclick={remove}>{words.deleteTable}</Button>
		</div>
	</Dialog>
{/if}
