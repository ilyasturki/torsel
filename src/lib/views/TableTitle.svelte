<script lang="ts">
	import { tick } from 'svelte';

	import { app } from '#lib/client/app.svelte.ts';
	import { pastedCells, shell } from '#lib/client/shell.svelte.ts';
	import { applyWithUndo, showToast } from '#lib/client/toast.svelte.ts';
	import { updateRecord } from '#lib/core/actions.ts';
	import { nameTaken } from '#lib/core/names.ts';
	import type { TableDef } from '#lib/core/model.ts';
	import { table as words } from '#lib/i18n/table.ts';
	import { fieldFill, fieldFocus } from '#lib/ui/styles.ts';

	import SourceGlyph from './SourceGlyph.svelte';
	import TableSwitcher from './TableSwitcher.svelte';

	let { table, rows }: { table: TableDef; rows: number } = $props();

	let editing = $state(false);
	let heading: HTMLElement | undefined = $state();
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
		const holder = nameTaken(app.ws.tables(table.base), name, table.id);
		if (holder !== undefined) {
			showToast(words.nameTaken(holder.name));
		} else if (name !== '' && name !== table.name) {
			applyWithUndo(updateRecord(app.ws, table.id, { name }), words.tableRenamed);
		}
	}

	/** A rename ended from the keyboard hands focus back to the name, not to the page. */
	async function refocus(): Promise<void> {
		await tick();
		heading?.querySelector<HTMLElement>('button')?.focus();
	}

	function select(node: HTMLInputElement): void {
		// `bind:value` fills the input after this runs, and an empty input selects nothing.
		node.value = draft;
		node.focus();
		node.select();
	}
</script>

<h1 bind:this={heading} class="flex min-w-0" aria-label={table.name}>
	{#if editing}
		<input
			use:select
			class="-mx-1.5 h-control w-full min-w-0 rounded-box px-1.5 font-semibold {fieldFill} {fieldFocus}"
			aria-label={words.tableName}
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
					event.preventDefault();
					commit();
					if (naming && rows === 0) shell.addingField = true;
					else void refocus();
					naming = false;
				} else if (event.key === 'Escape') {
					editing = false;
					naming = false;
					void refocus();
				}
			}}
		/>
	{:else}
		<TableSwitcher name={table.name} current={table.id} />
	{/if}
</h1>
{#if !editing}
	<SourceGlyph table={table.id} />
{/if}
