<script lang="ts">
	import { app } from '#lib/client/app.svelte.ts';
	import { ghostTables } from '#lib/client/assistant.svelte.ts';
	import { tableUrl } from '#lib/client/nav.ts';
	import { pastedCells, shell, startTable } from '#lib/client/shell.svelte.ts';
	import { showToast } from '#lib/client/toast.svelte.ts';
	import { createBase, deleteRecords, updateRecord } from '#lib/core/actions.ts';
	import type { BaseDef } from '#lib/core/model.ts';
	import Button from '#lib/ui/Button.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import { input } from '#lib/ui/styles.ts';
	import NameSheet from '#lib/views/NameSheet.svelte';

	let name = $state('');
	let creatingBase = $state(false);
	let renaming = $state<BaseDef | null>(null);

	const bases = $derived.by(() => {
		void app.version;
		return app.ws.bases().map((base) => ({
			...base,
			tables: app.ws.tables(base.id).map((table) => ({
				...table,
				rows: app.ws.rows(table.id).length
			}))
		}));
	});

	const proposals = $derived.by(() => {
		void app.version;
		return ghostTables();
	});

	const proposedBases = $derived([
		...new Map(
			proposals.filter((ghost) => ghost.baseProposed).map((ghost) => [ghost.base.id, ghost.base])
		).values()
	]);

	const empty = $derived(proposals.length === 0 && bases.every((base) => base.tables.length === 0));
	const grouped = $derived(bases.length + proposedBases.length > 1);

	function removeBase(base: BaseDef): void {
		const label = `Base "${base.name}" deleted`;
		const group = app.apply(deleteRecords(app.ws, [base.id]), label);
		showToast(label, group?.id ?? null);
	}

	function focusAtDesk(node: HTMLInputElement): void {
		// On touch, focus would raise the keyboard over the other ways to start.
		if (matchMedia('(pointer: fine)').matches) node.focus();
	}

	function pasteCells(event: ClipboardEvent): void {
		const text = pastedCells(event);
		if (text !== null) {
			event.preventDefault();
			shell.importing = { text, into: null };
		}
	}
</script>

{#snippet proposedRows(baseId: string)}
	{#each proposals.filter((ghost) => ghost.table.base === baseId) as ghost (ghost.table.id)}
		<a
			href={tableUrl(ghost.table.id)}
			class="flex min-h-row items-center gap-3 bg-tint px-4 transition-colors motion hover:bg-tint-2"
			data-testid="proposed-row"
		>
			<span class="min-w-0 truncate font-medium">{ghost.table.name}</span>
			<span class="flex-1 text-ink-3">Proposed</span>
			<span class="shrink-0 text-ink-3">{ghost.rows} {ghost.rows === 1 ? 'row' : 'rows'}</span>
		</a>
	{/each}
{/snippet}

<div class="flex min-h-full flex-col pb-tabs-clear">
	{#if empty}
		<Empty text="No tables yet. Name one, drop a CSV here, or paste cells.">
			<form
				class="flex gap-2"
				onsubmit={(event) => {
					event.preventDefault();
					startTable(undefined, name);
				}}
			>
				<input
					use:focusAtDesk
					class={input}
					bind:value={name}
					placeholder="Table name"
					aria-label="Table name"
					onpaste={pasteCells}
				/>
				<Button variant="primary" type="submit">New table</Button>
			</form>
			<Button onclick={() => (shell.importing = { into: null })}>Import a file</Button>
		</Empty>
	{:else}
		{#each bases as base (base.id)}
			{#if grouped}
				<div class="flex items-center gap-1 pt-4 pr-2 pb-1 pl-4">
					<h2 class="min-w-0 flex-1 truncate text-sm font-medium text-ink-3">{base.name}</h2>
					<Button variant="ghost" onclick={() => startTable(base.id)}>New table</Button>
					<Button variant="ghost" onclick={() => (renaming = base)}>Rename</Button>
					<Button variant="ghost" onclick={() => removeBase(base)}>Delete</Button>
				</div>
			{/if}
			{#each base.tables as table (table.id)}
				<a
					href={tableUrl(table.id)}
					class="flex min-h-row items-center gap-3 px-4 transition-colors motion hover:bg-tint"
				>
					<span class="min-w-0 flex-1 truncate font-medium">{table.name}</span>
					<span class="shrink-0 text-ink-3">{table.rows} {table.rows === 1 ? 'row' : 'rows'}</span>
				</a>
			{/each}
			{@render proposedRows(base.id)}
		{/each}
		{#each proposedBases as base (base.id)}
			{#if grouped}
				<h2 class="truncate pt-4 pr-2 pb-1 pl-4 text-sm font-medium text-ink-3">
					{base.name} (proposed)
				</h2>
			{/if}
			{@render proposedRows(base.id)}
		{/each}
		<div class="flex flex-wrap gap-2 p-4">
			{#if !grouped}
				<Button variant="primary" onclick={() => startTable()}>New table</Button>
			{/if}
			<Button onclick={() => (shell.importing = { into: null })}>Import a file</Button>
			<Button variant="ghost" onclick={() => (creatingBase = true)}>New base</Button>
		</div>
	{/if}
</div>

<NameSheet
	bind:open={creatingBase}
	title="New base"
	placeholder="Gym, Money, Reading"
	onsave={(name) => app.apply(createBase(app.ws, name).changes, `Base "${name}" created`)}
/>
<NameSheet
	open={renaming !== null}
	onclose={() => (renaming = null)}
	title="Rename base"
	initial={renaming?.name ?? ''}
	action="Rename"
	onsave={(name) => {
		if (renaming !== null) app.apply(updateRecord(app.ws, renaming.id, { name }), 'Base renamed');
	}}
/>
