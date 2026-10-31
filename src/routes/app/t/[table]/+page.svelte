<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	import { app } from '#lib/client/app.svelte.ts';
	import {
		accept,
		ghostTable,
		ghostViews,
		mayResume,
		reject
	} from '#lib/client/assistant.svelte.ts';
	import { HOME } from '#lib/client/nav.ts';
	import { viewToOpen } from '#lib/client/place.ts';
	import { shell } from '#lib/client/shell.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import Chart from '#lib/views/Chart.svelte';
	import Entry from '#lib/views/Entry.svelte';
	import Grid from '#lib/views/Grid.svelte';
	import List from '#lib/views/List.svelte';
	import TablePreview from '#lib/views/TablePreview.svelte';

	const tableId = $derived(page.params.table ?? '');

	const table = $derived.by(() => {
		void app.version;
		return app.ws.table(tableId);
	});

	const views = $derived.by(() => {
		void app.version;
		return app.ws.views(tableId);
	});

	const ghosts = $derived.by(() => {
		void app.version;
		return ghostViews(tableId);
	});

	const proposed = $derived.by(() => {
		void app.version;
		return ghostTable(tableId);
	});

	// A rejected table leaves nothing to look at, and this page's URL with it.
	let previewing = false;
	$effect(() => {
		if (proposed !== undefined) {
			previewing = true;
		} else if (previewing) {
			previewing = false;
			if (table === undefined) void goto(HOME, { replaceState: true });
		}
	});

	const requested = $derived(page.url.searchParams.get('v'));

	const ghost = $derived(ghosts.find((item) => item.view.id === requested));

	const view = $derived(ghost?.view ?? viewToOpen(views, tableId, requested));

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
	{#if proposed !== undefined}
		<TablePreview ghost={proposed} />
	{:else if !mayResume()}
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

		{#if ghost !== undefined}
			<div
				class="flex shrink-0 flex-wrap items-center gap-2 bg-tint-2 p-2 pl-3"
				data-testid="proposed-view"
			>
				<span class="min-w-0 flex-1 font-medium">Proposed view: {ghost.view.name}</span>
				<Button variant="primary" onclick={() => accept(ghost.action.id)}>Accept</Button>
				<Button onclick={() => reject(ghost.action.id)}>Reject</Button>
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
		{:else if ghost !== undefined && ghost.action.after.length > 0}
			<Empty
				text="This view is built on a field still waiting for your answer. Accept to see it."
			/>
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
