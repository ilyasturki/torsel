<script lang="ts">
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';

	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	import { app } from '#lib/client/app.svelte.ts';
	import { showToast } from '#lib/client/toast.svelte.ts';
	import { deleteRecords, updateRecord } from '#lib/core/actions.ts';
	import Chart from '#lib/views/Chart.svelte';
	import Entry from '#lib/views/Entry.svelte';
	import Grid from '#lib/views/Grid.svelte';
	import List from '#lib/views/List.svelte';
	import NameSheet from '#lib/views/NameSheet.svelte';
	import ViewSheet from '#lib/views/ViewSheet.svelte';

	const baseId = $derived(page.params.base ?? '');
	const tableId = $derived(page.params.table ?? '');

	const table = $derived.by(() => {
		void app.version;
		return app.ws.table(tableId);
	});

	const base = $derived.by(() => {
		void app.version;
		return app.ws.base(baseId);
	});

	const views = $derived.by(() => {
		void app.version;
		return app.ws.views(tableId);
	});

	const view = $derived(
		views.find((item) => item.id === page.url.searchParams.get('v')) ?? views[0]
	);

	const problems = $derived.by(() => {
		void app.version;
		return [...app.formulaProblems(tableId)].map(([id, message]) => ({
			name: app.ws.field(id)?.name ?? id,
			message
		}));
	});

	const CAPTIONS = {
		grid: 'Grille',
		entry: 'Saisie',
		list: 'Liste',
		chart: 'Graphique'
	};

	let settings = $state(false);
	let creating = $state(false);
	let renaming = $state(false);

	function removeTable(): void {
		if (table === undefined) return;
		const group = app.apply(deleteRecords(app.ws, [table.id]), `Table « ${table.name} » supprimée`);
		showToast(`Table « ${table.name} » supprimée`, group?.id ?? null);
		void goto(`/app/b/${baseId}`);
	}
</script>

{#if table === undefined || base === undefined}
	<p class="pt-10 text-center text-ink-muted">
		Cette table n’existe pas, ou plus. <a class="underline" href="/app">Retour</a>
	</p>
{:else}
	<div class="flex flex-col gap-3">
		<header class="flex flex-col gap-1">
			<a
				href="/app/b/{baseId}"
				class="-ml-2 flex h-11 items-center gap-1 self-start rounded-lg pr-2 text-ink-muted lg:hidden"
				><ChevronLeft class="size-5" /> {base.name}</a
			>
			<div class="flex items-center gap-1 px-1">
				<h1 class="min-w-0 truncate text-[28px] leading-9 font-bold tracking-tight">
					{table.name}
				</h1>
				<button
					type="button"
					class="flex size-10 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-hover"
					aria-label="Renommer la table"
					onclick={() => (renaming = true)}
				>
					<Pencil class="size-4" />
				</button>
			</div>
		</header>

		<nav
			aria-label="Vues"
			class="-mx-4 flex items-center gap-1 overflow-x-auto border-b border-line px-3 lg:-mx-2 lg:px-1"
			style="scrollbar-width: none"
		>
			{#each views as item (item.id)}
				<a
					href="/app/b/{baseId}/{tableId}?v={item.id}"
					class="flex h-11 shrink-0 items-center px-3 text-[15px] whitespace-nowrap {item.id ===
					view?.id
						? 'font-semibold text-ink shadow-[inset_0_-2px_0_var(--ink)]'
						: 'text-ink-muted'}"
					aria-current={item.id === view?.id ? 'page' : undefined}>{item.name}</a
				>
			{/each}
			<button
				type="button"
				class="flex size-10 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-hover"
				aria-label="Nouvelle vue"
				onclick={() => (creating = true)}
			>
				<Plus class="size-4" />
			</button>
			{#if view}
				<button
					type="button"
					class="ml-auto flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm text-ink-muted hover:bg-hover"
					aria-label="Réglages de la vue"
					onclick={() => (settings = true)}
				>
					<SlidersHorizontal class="size-4" /> <span class="hidden sm:inline">Réglages</span>
				</button>
			{/if}
		</nav>

		{#if problems.length > 0}
			<p class="rounded-xl bg-surface px-3 py-2 text-sm" role="alert">
				{#each problems as problem (problem.name)}
					<span class="block">« {problem.name} » ne se calcule pas : {problem.message}</span>
				{/each}
			</p>
		{/if}

		{#if view === undefined}
			<p class="rounded-2xl bg-surface px-4 py-10 text-center text-ink-muted">
				Cette table n’a pas de vue. Ajoute-en une avec +.
			</p>
		{:else}
			<p class="sr-only">{CAPTIONS[view.type]}</p>
			{#key view.id}
				{#if view.type === 'grid'}
					<Grid {tableId} {view} />
				{:else if view.type === 'entry'}
					<Entry {tableId} {view} />
				{:else if view.type === 'list'}
					<List {tableId} {view} />
				{:else}
					<Chart {tableId} {view} />
				{/if}
			{/key}
		{/if}

		<div class="mt-6 flex justify-end">
			<button
				type="button"
				class="h-10 rounded-xl px-3 text-sm text-ink-muted hover:bg-hover"
				onclick={removeTable}>Supprimer la table</button
			>
		</div>
	</div>

	<ViewSheet bind:open={settings} {tableId} viewId={view?.id ?? null} />
	<ViewSheet bind:open={creating} {tableId} />
	<NameSheet
		bind:open={renaming}
		title="Renommer la table"
		initial={table.name}
		action="Renommer"
		onsave={(name) => app.apply(updateRecord(app.ws, tableId, { name }), 'Table renommée')}
	/>
{/if}
