<script lang="ts">
	import '../app.css';

	import Plus from '@lucide/svelte/icons/plus';
	import Settings from '@lucide/svelte/icons/settings';

	import { page } from '$app/state';

	import { app } from '#lib/client/app.svelte.ts';
	import { showToast } from '#lib/client/toast.svelte.ts';
	import Logo from '#lib/ui/Logo.svelte';
	import AssistantLayer from '#lib/views/AssistantLayer.svelte';
	import CommandBar from '#lib/views/CommandBar.svelte';
	import SyncStatus from '#lib/views/SyncStatus.svelte';

	let { children } = $props();

	const bare = $derived(page.url.pathname === '/login');

	const title = $derived.by(() => {
		void app.version;
		const table = page.params.table ? app.ws.table(page.params.table) : undefined;
		const base = page.params.base ? app.ws.base(page.params.base) : undefined;
		const name =
			table?.name ?? base?.name ?? (page.url.pathname === '/settings' ? 'Réglages' : null);
		return name === null ? 'Torsel' : `${name} · Torsel`;
	});

	const bases = $derived.by(() => {
		void app.version;
		return app.ws.bases().map((base) => ({ ...base, tables: app.ws.tables(base.id) }));
	});

	function onkeydown(event: KeyboardEvent): void {
		const target = event.target as HTMLElement | null;
		const typing =
			target !== null &&
			(target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
		if (
			!typing &&
			(event.metaKey || event.ctrlKey) &&
			event.key.toLowerCase() === 'z' &&
			!event.shiftKey
		) {
			event.preventDefault();
			const group = app.undo();
			showToast(group === undefined ? 'Rien à annuler' : `Annulé : ${group.label}`);
		}
	}
</script>

<svelte:head>
	<title>{title}</title>
</svelte:head>

<svelte:window {onkeydown} />

{#if bare}
	{@render children()}
{:else}
	<div class="flex min-h-dvh">
		<nav
			aria-label="Bases"
			class="fixed inset-y-0 left-0 hidden w-64 flex-col gap-4 overflow-y-auto border-r border-line-soft px-3 py-5 lg:flex"
		>
			<a href="/" class="px-2">
				<Logo wordmark class="h-5" />
			</a>
			<div class="flex flex-col gap-0.5">
				{#each bases as base (base.id)}
					<a
						href="/b/{base.id}"
						class="flex min-h-9 items-center rounded-lg px-2 text-[14px] font-semibold hover:bg-hover {page
							.params.base === base.id && !page.params.table
							? 'bg-surface'
							: ''}">{base.name}</a
					>
					{#each base.tables as table (table.id)}
						<a
							href="/b/{base.id}/{table.id}"
							class="flex min-h-8 items-center rounded-lg pr-2 pl-5 text-[14px] text-ink-muted hover:bg-hover {page
								.params.table === table.id
								? 'bg-surface font-medium text-ink'
								: ''}">{table.name}</a
						>
					{/each}
				{/each}
				<a
					href="/?new=1"
					class="mt-1 flex min-h-9 items-center gap-2 rounded-lg px-2 text-[14px] text-ink-muted hover:bg-hover"
					><Plus class="size-4" /> Nouvelle base</a
				>
			</div>
			<div class="mt-auto flex flex-col gap-1">
				<a
					href="/settings"
					class="flex min-h-9 items-center gap-2 rounded-lg px-2 text-[14px] text-ink-muted hover:bg-hover"
					><Settings class="size-4" /> Réglages</a
				>
			</div>
		</nav>

		<main
			class="min-w-0 flex-1 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-36 lg:ml-64 lg:px-8 lg:pt-6"
		>
			<SyncStatus />
			{@render children()}
		</main>
	</div>

	{#if page.url.pathname !== '/settings'}
		<CommandBar />
	{/if}
	<AssistantLayer />
{/if}
