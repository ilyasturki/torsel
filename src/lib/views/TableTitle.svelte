<script lang="ts">
	import { app } from '#lib/client/app.svelte.ts';
	import { pastedCells, shell } from '#lib/client/shell.svelte.ts';
	import { applyWithUndo } from '#lib/client/toast.svelte.ts';
	import { updateRecord } from '#lib/core/actions.ts';
	import type { TableDef } from '#lib/core/model.ts';
	import { fieldFocus } from '#lib/ui/styles.ts';

	import TableSwitcher from './TableSwitcher.svelte';

	let { table, rows }: { table: TableDef; rows: number } = $props();

	let editing = $state(false);
	let draft = $state('');
	let naming = false;

	$effect(() => {
		if (shell.namingTable === table.id) {
			shell.namingTable = null;
			naming = true;
			begin();
		} else if (shell.renamingTable === table.id) {
			shell.renamingTable = null;
			naming = false;
			begin();
		}
	});

	function begin(): void {
		draft = table.name;
		editing = true;
	}

	function commit(): void {
		if (!editing) return;
		editing = false;
		const name = draft.trim();
		if (name !== '' && name !== table.name) {
			applyWithUndo(updateRecord(app.ws, table.id, { name }), 'Table renamed');
		}
	}

	function select(node: HTMLInputElement): void {
		// `bind:value` fills the input after this runs, and an empty input selects nothing.
		node.value = draft;
		node.focus();
		node.select();
	}
</script>

<h1 class="flex min-w-0" aria-label={table.name}>
	{#if editing}
		<input
			use:select
			class="-mx-1.5 h-control w-full min-w-0 rounded-box bg-tint px-1.5 font-semibold {fieldFocus}"
			aria-label="Table name"
			bind:value={draft}
			onblur={commit}
			onpaste={(event) => {
				const text = rows === 0 ? pastedCells(event) : null;
				if (text !== null) {
					event.preventDefault();
					editing = false;
					shell.importing = { text, into: table.id };
				}
			}}
			onkeydown={(event) => {
				if (event.key === 'Enter') {
					commit();
					if (naming && rows === 0) shell.addingField = true;
					naming = false;
				} else if (event.key === 'Escape') {
					editing = false;
					naming = false;
				}
			}}
		/>
	{:else}
		<TableSwitcher name={table.name} current={table.id} />
	{/if}
</h1>
