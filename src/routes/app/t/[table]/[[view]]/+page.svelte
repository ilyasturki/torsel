<script lang="ts">
	import { untrack } from 'svelte';

	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	import { app } from '#lib/client/app.svelte.ts';
	import { tableBySlug, viewBySlug } from '#lib/client/directory.svelte.ts';
	import { HOME, tableUrl } from '#lib/client/nav.ts';
	import { shell } from '#lib/client/shell.svelte.ts';
	import { caughtUp } from '#lib/client/sync.svelte.ts';
	import { showToast } from '#lib/client/toast.svelte.ts';
	import { table as words } from '#lib/i18n/table.ts';
	import Button from '#lib/ui/Button.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import Chart from '#lib/views/Chart.svelte';
	import Entry from '#lib/views/Entry.svelte';
	import Grid from '#lib/views/Grid.svelte';
	import List from '#lib/views/List.svelte';
	import { shownView } from '#lib/views/pin.svelte.ts';

	const tableId = $derived(tableBySlug(page.params.table ?? '') ?? '');

	const table = $derived.by(() => {
		void app.version;
		return app.ws.table(tableId);
	});

	const views = $derived.by(() => {
		void app.version;
		return app.ws.views(tableId);
	});

	const requested = $derived(
		page.params.view === undefined ? undefined : viewBySlug(tableId, page.params.view)
	);

	const view = $derived(shownView(tableId, views, requested));

	// An id, an old name or the first view's own slug: the address bar shows the current one.
	$effect(() => {
		if (table === undefined) return;
		const canonical = tableUrl(table.id, view?.id);
		if (page.url.pathname !== canonical) {
			void goto(canonical, { replace: true, reset: false });
		}
	});

	// The address a table was last shown at: losing it there is not landing on an unknown one.
	let shown: string | undefined;
	let lost = $state(false);
	$effect(() => {
		const segment = page.params.table;
		lost = false;
		if (table !== undefined) {
			shown = segment;
		} else if (segment === shown) {
			lost = true;
		} else if (app.ready && caughtUp()) {
			untrack(() => showToast(words.notFound));
			void goto(HOME, { replace: true });
		}
	});

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
	{#if lost}
		<Empty text={words.gone}>
			<a href={HOME} class="underline">{words.seeTables}</a>
		</Empty>
	{/if}
{:else}
	<div class="flex h-full flex-col">
		{#if problems.length > 0}
			<div class="flex shrink-0 flex-col gap-1 bg-tint p-3" role="alert">
				{#each problems as problem (problem.name)}
					<p>{words.cantCalculate(problem.name, problem.message)}</p>
				{/each}
			</div>
		{/if}

		{#if blank}
			<div class="shrink-0">
				<Empty text={words.empty}>
					<Button onclick={() => (shell.addingField = true)}>{words.addField}</Button>
					<Button onclick={() => (shell.importing = { into: tableId })}>{words.importFile}</Button>
				</Empty>
			</div>
		{/if}

		{#if view === undefined}
			<Empty text={words.noView} />
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
