<script lang="ts">
	import { goto } from '$app/navigation';

	import { app } from '#lib/client/app.svelte.ts';
	import { tableUrl } from '#lib/client/nav.ts';
	import { showToast } from '#lib/client/toast.svelte.ts';
	import { blankTable, createBase, deleteRecords, updateRecord } from '#lib/core/actions.ts';
	import type { BaseDef } from '#lib/core/model.ts';
	import Button from '#lib/ui/Button.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import ImportSheet from '#lib/views/ImportSheet.svelte';
	import NameSheet from '#lib/views/NameSheet.svelte';

	let importing = $state(false);
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

	const empty = $derived(bases.every((base) => base.tables.length === 0));
	const grouped = $derived(bases.length > 1);

	function newTable(baseId?: string): void {
		const made = blankTable(app.ws, baseId);
		app.apply(made.changes, `Table "${made.name}" created`);
		void goto(tableUrl(made.id));
	}

	function removeBase(base: BaseDef): void {
		const label = `Base "${base.name}" deleted`;
		const group = app.apply(deleteRecords(app.ws, [base.id]), label);
		showToast(label, group?.id ?? null);
	}
</script>

<div class="flex min-h-full flex-col pb-tabs-clear">
	{#if empty}
		<Empty text="No tables yet. Start a table, or import a CSV.">
			<Button variant="primary" onclick={() => newTable()}>New table</Button>
			<Button onclick={() => (importing = true)}>Import a CSV</Button>
		</Empty>
	{:else}
		{#each bases as base (base.id)}
			{#if grouped}
				<div class="flex items-center gap-1 pt-4 pr-2 pb-1 pl-4">
					<h2 class="min-w-0 flex-1 truncate text-sm font-medium text-ink-3">{base.name}</h2>
					<Button variant="ghost" onclick={() => newTable(base.id)}>New table</Button>
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
		{/each}
		<div class="flex flex-wrap gap-2 p-4">
			{#if !grouped}
				<Button variant="primary" onclick={() => newTable()}>New table</Button>
			{/if}
			<Button onclick={() => (importing = true)}>Import a CSV</Button>
			<Button variant="ghost" onclick={() => (creatingBase = true)}>New base</Button>
		</div>
	{/if}
</div>

<ImportSheet bind:open={importing} />
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
