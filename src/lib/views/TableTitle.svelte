<script lang="ts">
	import { app } from '#lib/client/app.svelte.ts';
	import { pastedCells, shell } from '#lib/client/shell.svelte.ts';
	import { updateRecord } from '#lib/core/actions.ts';
	import type { TableDef } from '#lib/core/model.ts';

	let { table, rows }: { table: TableDef; rows: number } = $props();

	let editing = $state(false);
	let draft = $state('');
	let naming = false;

	$effect(() => {
		if (shell.namingTable === table.id) {
			shell.namingTable = null;
			naming = true;
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
			app.apply(updateRecord(app.ws, table.id, { name }), 'Table renamed');
		}
	}

	function select(node: HTMLInputElement): void {
		// `bind:value` fills the input after this runs, and an empty input selects nothing.
		node.value = draft;
		node.focus();
		node.select();
	}
</script>

<h1 class="flex min-w-0 text-xl font-semibold tight max-sm:text-lg" aria-label={table.name}>
	{#if editing}
		<input
			use:select
			class="w-full min-w-0 rounded-box bg-tint px-1 outline-none"
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
		<button
			type="button"
			class="min-w-0 truncate text-left"
			title="Rename"
			onclick={() => {
				naming = false;
				begin();
			}}>{table.name}</button
		>
	{/if}
</h1>
