<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	import { app } from '#lib/client/app.svelte.ts';
	import { gridJump } from '#lib/client/grid.svelte.ts';
	import { HOME, LOGIN, SETTINGS, tableUrl } from '#lib/client/nav.ts';
	import { me } from '#lib/client/session.svelte.ts';
	import { showToast } from '#lib/client/toast.svelte.ts';
	import { blankTable, updateRecord } from '#lib/core/actions.ts';
	import Button from '#lib/ui/Button.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import Logo from '#lib/ui/Logo.svelte';
	import Segmented from '#lib/ui/Segmented.svelte';
	import AskPanel from '#lib/views/AskPanel.svelte';
	import NameSheet from '#lib/views/NameSheet.svelte';
	import RowSheet from '#lib/views/RowSheet.svelte';
	import SyncStatus from '#lib/views/SyncStatus.svelte';
	import TableMenu from '#lib/views/TableMenu.svelte';
	import Toast from '#lib/views/Toast.svelte';
	import ViewSheet from '#lib/views/ViewSheet.svelte';

	let { children } = $props();

	const bare = $derived(page.url.pathname === LOGIN);
	const onSettings = $derived(page.url.pathname === SETTINGS);
	const tableId = $derived(page.params.table ?? null);

	const table = $derived.by(() => {
		void app.version;
		return tableId === null ? undefined : app.ws.table(tableId);
	});

	const views = $derived.by(() => {
		void app.version;
		return table === undefined ? [] : app.ws.views(table.id);
	});

	const view = $derived(
		views.find((item) => item.id === page.url.searchParams.get('v')) ?? views[0]
	);

	const tables = $derived.by(() => {
		void app.version;
		return app.ws.bases().flatMap((base) => app.ws.tables(base.id));
	});

	const rowCount = $derived.by(() => {
		void app.version;
		return table === undefined ? 0 : app.ws.rows(table.id).length;
	});

	const heading = $derived(table?.name ?? (onSettings ? 'Settings' : 'Tables'));

	let asking = $state(false);
	let menuOpen = $state(false);
	let viewSettings = $state(false);
	let viewCreating = $state(false);
	let renaming = $state(false);
	let rowOpen = $state(false);

	function undo(): void {
		const group = app.undo();
		showToast(group === undefined ? 'Nothing to undo' : `Undid: ${group.label}`);
	}

	function newTable(): void {
		const made = blankTable(app.ws);
		app.apply(made.changes, `Table "${made.name}" created`);
		void goto(tableUrl(made.id));
	}

	function onkeydown(event: KeyboardEvent): void {
		const target = event.target as HTMLElement | null;
		const typing =
			target !== null &&
			(target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
		const command = event.metaKey || event.ctrlKey;

		if (command && event.key.toLowerCase() === 'k') {
			event.preventDefault();
			asking = !asking;
		} else if (!typing && command && event.key.toLowerCase() === 'z' && !event.shiftKey) {
			event.preventDefault();
			undo();
		} else if (event.altKey && !command && /^[1-9]$/u.test(event.key) && table !== undefined) {
			const next = views[Number(event.key) - 1];
			if (next !== undefined) {
				event.preventDefault();
				void goto(tableUrl(table.id, next.id));
			}
		}
	}
</script>

<svelte:head>
	<title>{heading === 'Tables' ? 'Torsel' : `${heading} · Torsel`}</title>
</svelte:head>

<svelte:window {onkeydown} />

{#if bare}
	{@render children()}
{:else}
	<div class="relative flex h-dvh flex-col overflow-clip pt-safe">
		<header class="flex shrink-0 items-center gap-3 px-gutter pt-5 max-lg:flex-wrap">
			<a href={HOME} class="mr-1 shrink-0 text-ink-2 hover:text-ink">
				<Logo wordmark class="h-4 max-sm:hidden" />
				<Logo class="h-5 sm:hidden" />
			</a>
			<div class="flex min-w-0 items-center gap-3 max-lg:flex-1">
				<h1 class="min-w-0 truncate text-xl font-semibold tight">{heading}</h1>
				{#if table !== undefined}
					<span class="shrink-0 pt-1 text-ink-3">{rowCount} {rowCount === 1 ? 'row' : 'rows'}</span>
				{/if}
			</div>
			<SyncStatus />
			<div class="ml-auto flex shrink-0 items-center gap-1">
				<Button
					variant="ghost"
					class="max-sm:hidden"
					disabled={app.history.length === 0}
					onclick={undo}>Undo</Button
				>
				{#if me.account}
					<Button
						variant="ghost"
						class={asking ? 'bg-tint-2 text-ink' : ''}
						aria-pressed={asking}
						onclick={() => (asking = !asking)}
						>Ask <span class="text-sm text-ink-3 max-sm:hidden">Ctrl K</span></Button
					>
				{/if}
				<a
					href={SETTINGS}
					class="inline-flex h-control items-center rounded-box px-3 font-medium text-ink-2 transition-colors motion hover:bg-tint hover:text-ink {table ===
					undefined
						? ''
						: 'max-sm:hidden'}">Settings</a
				>
				{#if table !== undefined}
					<Button
						variant="ghost"
						class="sm:hidden"
						aria-label="More"
						onclick={() => (menuOpen = true)}><Icon name="more" /></Button
					>
				{/if}
			</div>
		</header>

		{#if table !== undefined}
			<div class="flex shrink-0 items-center gap-2 px-gutter pt-3">
				<Segmented
					label="Views"
					class="max-sm:flex-1"
					items={views.map((item) => ({
						id: item.id,
						label: item.name,
						href: tableUrl(table.id, item.id),
						active: item.id === view?.id
					}))}
				/>
				<Button
					variant="ghost"
					class="w-control px-0 max-sm:hidden"
					aria-label="New view"
					onclick={() => (viewCreating = true)}><Icon name="plus" /></Button
				>
				<Button
					variant="ghost"
					class="w-control px-0 max-sm:hidden"
					aria-label="More"
					onclick={() => (menuOpen = true)}><Icon name="more" /></Button
				>
				{#if view?.type !== 'entry'}
					<Button
						variant="primary"
						class="ml-auto max-sm:hidden"
						onclick={() => {
							if (view?.type === 'grid') gridJump.blankRow += 1;
							else rowOpen = true;
						}}>New row</Button
					>
				{/if}
			</div>
		{/if}

		<div class="relative flex min-h-0 flex-1 px-gutter pt-3 pb-5 max-sm:px-0 max-sm:pb-0">
			<main
				class="isolate min-w-0 flex-1 overflow-auto rounded-panel bg-raised shadow-raised transition-[margin] motion-slow max-sm:rounded-none max-sm:bg-transparent max-sm:shadow-none {asking
					? 'lg:mr-ask-clear'
					: ''}"
			>
				{@render children()}
			</main>
			{#if me.account}
				<AskPanel bind:open={asking} table={table ?? null} view={view ?? null} />
			{/if}
		</div>

		<div
			class="pointer-events-none absolute inset-x-gutter bottom-8 flex justify-center pb-safe transition-[right] motion-slow max-sm:bottom-3 {asking
				? 'lg:right-tabs-ask'
				: ''}"
		>
			<Segmented
				label="Tables"
				tone="float"
				class="pointer-events-auto"
				items={[
					{ id: 'all', label: 'All', href: HOME, active: page.url.pathname === HOME },
					...tables.map((item) => ({
						id: item.id,
						label: item.name,
						href: tableUrl(item.id),
						active: item.id === tableId
					}))
				]}
			>
				{#snippet after()}
					<button
						type="button"
						class="relative flex size-control shrink-0 items-center justify-center text-ink-2 transition-colors motion hover:text-ink"
						aria-label="New table"
						onclick={newTable}><Icon name="plus" /></button
					>
				{/snippet}
			</Segmented>
		</div>

		<Toast />
	</div>

	{#if table !== undefined}
		<TableMenu
			bind:open={menuOpen}
			{table}
			onrename={() => (renaming = true)}
			onviewsettings={() => (viewSettings = true)}
			onnewview={() => (viewCreating = true)}
			onnewrow={() => (rowOpen = true)}
			onundo={undo}
			canUndo={app.history.length > 0}
		/>
		<ViewSheet bind:open={viewSettings} tableId={table.id} viewId={view?.id ?? null} />
		<ViewSheet bind:open={viewCreating} tableId={table.id} />
		<RowSheet bind:open={rowOpen} tableId={table.id} />
		<NameSheet
			bind:open={renaming}
			title="Rename table"
			initial={table.name}
			action="Rename"
			onsave={(name) => {
				if (table !== undefined)
					app.apply(updateRecord(app.ws, table.id, { name }), 'Table renamed');
			}}
		/>
	{/if}
{/if}
