<script lang="ts">
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import FileUp from '@lucide/svelte/icons/file-up';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';

	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	import { app } from '#lib/client/app.svelte.ts';
	import { showToast } from '#lib/client/toast.svelte.ts';
	import { createTable, deleteRecords, updateRecord } from '#lib/core/actions.ts';
	import Button from '#lib/ui/Button.svelte';
	import ImportSheet from '#lib/views/ImportSheet.svelte';
	import NameSheet from '#lib/views/NameSheet.svelte';

	const baseId = $derived(page.params.base ?? '');

	const base = $derived.by(() => {
		void app.version;
		return app.ws.base(baseId);
	});

	const tables = $derived.by(() => {
		void app.version;
		return app.ws
			.tables(baseId)
			.map((table) => ({
				...table,
				rows: app.ws.rows(table.id).length,
				views: app.ws.views(table.id).length
			}));
	});

	let naming = $state(false);
	let renaming = $state(false);
	let importing = $state(false);

	function create(name: string): void {
		const { id, changes } = createTable(app.ws, baseId, name, [{ name: 'Nom', type: 'text' }]);
		app.apply(changes, `Table « ${name} » créée`);
		void goto(`/b/${baseId}/${id}`);
	}

	function remove(): void {
		if (base === undefined) return;
		const group = app.apply(deleteRecords(app.ws, [base.id]), `Base « ${base.name} » supprimée`);
		showToast(`Base « ${base.name} » supprimée`, group?.id ?? null);
		void goto('/');
	}
</script>

{#if base === undefined}
	<p class="pt-10 text-center text-ink-muted">
		Cette base n’existe pas, ou plus. <a class="underline" href="/">Retour</a>
	</p>
{:else}
	<div class="mx-auto flex max-w-2xl flex-col gap-5 pt-1">
		<header class="flex flex-col gap-1">
			<a
				href="/"
				class="-ml-2 flex h-11 items-center gap-1 self-start rounded-lg pr-2 text-ink-muted lg:hidden"
				><ChevronLeft class="size-5" /> Bases</a
			>
			<div class="flex items-center gap-2 px-1">
				<h1 class="text-[30px] leading-9 font-bold tracking-tight">{base.name}</h1>
				<button
					type="button"
					class="flex size-10 items-center justify-center rounded-full text-ink-muted hover:bg-hover"
					aria-label="Renommer la base"
					onclick={() => (renaming = true)}
				>
					<Pencil class="size-4" />
				</button>
			</div>
		</header>

		{#if tables.length > 0}
			<div class="flex flex-col overflow-hidden rounded-2xl bg-surface">
				{#each tables as table (table.id)}
					<a
						href="/b/{baseId}/{table.id}"
						class="flex min-h-16 items-center gap-3 border-b border-line-soft px-4 py-3 last:border-b-0 hover:bg-hover"
					>
						<span class="flex flex-1 flex-col">
							<span class="text-[17px] font-semibold">{table.name}</span>
							<span class="text-sm text-ink-muted"
								>{table.rows} ligne{table.rows > 1 ? 's' : ''} · {table.views} vue{table.views > 1
									? 's'
									: ''}</span
							>
						</span>
						<ChevronRight class="size-5 text-ink-faint" />
					</a>
				{/each}
			</div>
		{:else}
			<p class="rounded-2xl bg-surface px-5 py-8 text-center text-ink-muted">
				Pas encore de table. Crée-en une, importe un CSV, ou demande-la à l’IA.
			</p>
		{/if}

		<div class="flex flex-wrap gap-2">
			<Button onclick={() => (naming = true)}><Plus class="size-4" /> Nouvelle table</Button>
			<Button onclick={() => (importing = true)}><FileUp class="size-4" /> Importer un CSV</Button>
			<Button variant="ghost" class="ml-auto" onclick={remove}>Supprimer la base</Button>
		</div>
	</div>

	<NameSheet
		bind:open={naming}
		title="Nouvelle table"
		placeholder="Séries, Pesées, Dépenses…"
		onsave={create}
	/>
	<NameSheet
		bind:open={renaming}
		title="Renommer la base"
		initial={base.name}
		action="Renommer"
		onsave={(name) => app.apply(updateRecord(app.ws, baseId, { name }), 'Base renommée')}
	/>
	<ImportSheet bind:open={importing} {baseId} />
{/if}
