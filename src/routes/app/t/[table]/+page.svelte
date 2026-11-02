<script lang="ts">
	import { page } from '$app/state';

	import { app } from '#lib/client/app.svelte.ts';
	import { HOME } from '#lib/client/nav.ts';
	import { viewToOpen } from '#lib/client/place.ts';
	import { shell } from '#lib/client/shell.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import Chart from '#lib/views/Chart.svelte';
	import Entry from '#lib/views/Entry.svelte';
	import Grid from '#lib/views/Grid.svelte';
	import List from '#lib/views/List.svelte';

	const tableId = $derived(page.params.table ?? '');

	const table = $derived.by(() => {
		void app.version;
		return app.ws.table(tableId);
	});

	const views = $derived.by(() => {
		void app.version;
		return app.ws.views(tableId);
	});

	const requested = $derived(page.url.searchParams.get('v'));

	const view = $derived(viewToOpen(views, tableId, requested));

	const blank = $derived.by(() => {
		void app.version;
		return view?.type === 'grid' && app.ws.rows(tableId).length === 0;
	});

	const problems = $derived.by(() => {
		void app.version;
		return [...app.formulaProblems(tableId)].map(([id, message]) => ({
			name: app.ws.field(id)?.name ?? id,
			message
		}));
	});
</script>

{#if table === undefined}
	{#if app.ready}
		<Empty text="This table no longer exists.">
			<a href={HOME} class="underline">See your tables</a>
		</Empty>
	{/if}
{:else}
	<div class="flex h-full flex-col">
		{#if problems.length > 0}
			<div class="flex shrink-0 flex-col gap-1 bg-tint p-3" role="alert">
				{#each problems as problem (problem.name)}
					<p>{problem.name} can't be calculated: {problem.message}</p>
				{/each}
			</div>
		{/if}

		{#if blank}
			<div class="shrink-0">
				<Empty
					text="This table is empty. Add its fields and a first row, drop a CSV here, or paste cells."
				>
					<Button onclick={() => (shell.addingField = true)}>Add a field</Button>
					<Button onclick={() => (shell.importing = { into: tableId })}>Import a file</Button>
				</Empty>
			</div>
		{/if}

		{#if view === undefined}
			<Empty text="This table has no view yet. Add one with the plus above." />
		{:else}
			{#key view.id}
				<div class="min-h-0 flex-1 enter">
					{#if view.type === 'grid'}
						<Grid {tableId} {view} />
					{:else if view.type === 'entry'}
						<Entry {tableId} {view} />
					{:else if view.type === 'list'}
						<List {tableId} {view} />
					{:else}
						<Chart {tableId} {view} />
					{/if}
				</div>
			{/key}
		{/if}
	</div>
{/if}
