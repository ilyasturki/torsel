<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import FileUp from '@lucide/svelte/icons/file-up';
	import Plus from '@lucide/svelte/icons/plus';
	import Settings from '@lucide/svelte/icons/settings';

	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	import { app } from '#lib/client/app.svelte.ts';
	import { createBase } from '#lib/core/actions.ts';
	import Button from '#lib/ui/Button.svelte';
	import ImportSheet from '#lib/views/ImportSheet.svelte';
	import NameSheet from '#lib/views/NameSheet.svelte';

	let naming = $state(false);
	let importing = $state(false);

	$effect(() => {
		if (page.url.searchParams.get('new') === '1') {
			naming = true;
			void goto('/', { replaceState: true });
		}
	});

	const bases = $derived.by(() => {
		void app.version;
		return app.ws.bases().map((base) => {
			const tables = app.ws.tables(base.id);
			const rows = tables.reduce((total, table) => total + app.ws.rows(table.id).length, 0);
			return { ...base, tables, rows };
		});
	});

	function create(name: string): void {
		const { id, changes } = createBase(app.ws, name);
		app.apply(changes, `Base « ${name} » créée`);
		void goto(`/b/${id}`);
	}
</script>

<div class="mx-auto flex max-w-2xl flex-col gap-5 pt-4">
	<header class="flex items-center justify-between px-1">
		<h1 class="text-[32px] leading-10 font-bold tracking-tight">Bases</h1>
		<a
			href="/settings"
			class="flex size-11 items-center justify-center rounded-full hover:bg-hover lg:hidden"
			aria-label="Réglages"
		>
			<Settings class="size-5" />
		</a>
	</header>

	{#if bases.length > 0}
		<div class="flex flex-col overflow-hidden rounded-2xl bg-surface">
			{#each bases as base (base.id)}
				<a
					href="/b/{base.id}"
					class="flex min-h-16 items-center gap-3 border-b border-line-soft px-4 py-3 last:border-b-0 hover:bg-hover"
				>
					<span class="flex min-w-0 flex-1 flex-col">
						<span class="text-[17px] font-semibold">{base.name}</span>
						<span class="truncate text-sm text-ink-muted">
							{base.tables.map((table) => table.name).join(', ') || 'Vide'}{base.rows > 0
								? ` · ${base.rows} ligne${base.rows > 1 ? 's' : ''}`
								: ''}
						</span>
					</span>
					<ChevronRight class="size-5 text-ink-faint" />
				</a>
			{/each}
		</div>
	{:else}
		<div class="flex flex-col gap-2 rounded-2xl bg-surface px-5 py-8 text-center">
			<p class="text-[17px] font-semibold">Rien pour l’instant</p>
			<p class="text-ink-muted">
				Crée une base, importe un CSV, ou décris ce que tu veux suivre dans la barre en bas.
			</p>
		</div>
	{/if}

	<div class="flex flex-wrap gap-2">
		<Button onclick={() => (naming = true)}><Plus class="size-4" /> Nouvelle base</Button>
		<Button onclick={() => (importing = true)}><FileUp class="size-4" /> Importer un CSV</Button>
	</div>
</div>

<NameSheet
	bind:open={naming}
	title="Nouvelle base"
	placeholder="Muscu, Dépenses, Lectures…"
	onsave={create}
/>
<ImportSheet bind:open={importing} />
