<script lang="ts">
	import { onMount } from 'svelte';

	import { dev } from '$app/env';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	import { app } from '#lib/client/app.svelte.ts';
	import {
		assistant,
		checkAvailability,
		ghostTables,
		ghostViews,
		resumeThread
	} from '#lib/client/assistant.svelte.ts';
	import { gridJump } from '#lib/client/grid.svelte.ts';
	import { HOME, LOGIN, SETTINGS, tableUrl } from '#lib/client/nav.ts';
	import { viewToOpen, visitHome, visitTable } from '#lib/client/place.ts';
	import { me } from '#lib/client/session.svelte.ts';
	import { pastedCells, shell, startTable } from '#lib/client/shell.svelte.ts';
	import { followOtherTabs, sync } from '#lib/client/sync.svelte.ts';
	import { showToast } from '#lib/client/toast.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import Logo from '#lib/ui/Logo.svelte';
	import Segmented from '#lib/ui/Segmented.svelte';
	import AskPanel from '#lib/views/AskPanel.svelte';
	import ImportSheet from '#lib/views/ImportSheet.svelte';
	import RowSheet from '#lib/views/RowSheet.svelte';
	import SyncStatus from '#lib/views/SyncStatus.svelte';
	import TableMenu from '#lib/views/TableMenu.svelte';
	import TableTitle from '#lib/views/TableTitle.svelte';
	import Toast from '#lib/views/Toast.svelte';
	import ViewSheet from '#lib/views/ViewSheet.svelte';

	let { children } = $props();

	onMount(followOtherTabs);

	onMount(() => {
		if (!dev && !import.meta.env.APP_BUILD && 'serviceWorker' in navigator) {
			// Scope `/app`, no trailing slash: it covers `/app` itself and leaves `/` uncontrolled.
			navigator.serviceWorker
				.register('/service-worker.js', { type: 'module', scope: '/app' })
				.catch((error: unknown) => console.warn('no offline shell:', error));
		}
	});

	onMount(() => {
		if (!import.meta.env.APP_BUILD) return;
		const listening = import('@capacitor/app').then(({ App }) =>
			App.addListener('backButton', ({ canGoBack }) => {
				if (canGoBack) history.back();
				else void App.exitApp();
			})
		);
		return () => void listening.then((handle) => handle.remove());
	});

	const bare = $derived(page.url.pathname === LOGIN || page.url.pathname.startsWith(`${LOGIN}/`));
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

	const ghosts = $derived.by(() => {
		void app.version;
		return table === undefined ? [] : ghostViews(table.id).map((ghost) => ghost.view);
	});

	const view = $derived.by(() => {
		const requested = page.url.searchParams.get('v');
		return table === undefined
			? undefined
			: (ghosts.find((item) => item.id === requested) ?? viewToOpen(views, table.id, requested));
	});

	const proposedView = $derived(view !== undefined && ghosts.some((item) => item.id === view.id));

	$effect(() => {
		void me.account;
		void checkAvailability();
	});

	$effect(() => {
		if (assistant.available === true && me.account) {
			void resumeThread();
		}
	});

	$effect(() => {
		if (table !== undefined && view !== undefined && !proposedView) {
			visitTable(table.id, view.id);
		} else if (page.url.pathname === HOME) {
			visitHome();
		}
	});

	const tables = $derived.by(() => {
		void app.version;
		return app.ws.bases().flatMap((base) => app.ws.tables(base.id));
	});

	const proposals = $derived.by(() => {
		void app.version;
		return ghostTables();
	});

	const proposed = $derived(proposals.find((ghost) => ghost.table.id === tableId));
	const onTable = $derived(table !== undefined || proposed !== undefined);

	const rowCount = $derived.by(() => {
		void app.version;
		return table === undefined ? 0 : app.ws.rows(table.id).length;
	});

	const heading = $derived(
		table?.name ?? proposed?.table.name ?? (onSettings ? 'Settings' : 'Tables')
	);

	let asking = $state(false);
	let menuOpen = $state(false);
	let viewSettings = $state(false);
	let viewCreating = $state(false);
	let dropping = $state(false);

	function undo(): void {
		const group = app.undo();
		showToast(group === undefined ? 'Nothing to undo' : `Undid: ${group.label}`);
	}

	function redo(): void {
		const group = app.redo();
		showToast(group === undefined ? 'Nothing to redo' : `Redid: ${group.label}`);
	}

	function isTyping(target: EventTarget | null): boolean {
		return (
			target instanceof HTMLElement &&
			(target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
		);
	}

	const NO_KEYBOARD = new Set([
		'button',
		'checkbox',
		'color',
		'date',
		'datetime-local',
		'file',
		'month',
		'radio',
		'range',
		'reset',
		'submit',
		'time',
		'week'
	]);

	let keyboardUp = $state(false);

	function opensKeyboard(target: EventTarget | null): boolean {
		if (!(target instanceof HTMLElement) || target.inputMode === 'none') return false;
		if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
		return target instanceof HTMLInputElement && !NO_KEYBOARD.has(target.type);
	}

	function hasFiles(event: DragEvent): boolean {
		return event.dataTransfer?.types.includes('Files') === true;
	}

	function ondragover(event: DragEvent): void {
		if (!bare && hasFiles(event)) {
			event.preventDefault();
			dropping = true;
		}
	}

	function ondrop(event: DragEvent): void {
		dropping = false;
		const file = event.dataTransfer?.files[0];
		if (!bare && file !== undefined) {
			event.preventDefault();
			shell.importing = { file, into: table?.id ?? null };
		}
	}

	/** Cells pasted where no grid cell took them start a table, or fill an empty one. */
	function onpaste(event: ClipboardEvent): void {
		if (
			event.defaultPrevented ||
			isTyping(event.target) ||
			document.querySelector('[role=dialog]')
		) {
			return;
		}
		const onHome = page.url.pathname === HOME;
		if ((table !== undefined && rowCount === 0) || onHome) {
			const text = pastedCells(event);
			if (text !== null) {
				event.preventDefault();
				shell.importing = { text, into: table?.id ?? null };
			}
		}
	}

	function onkeydown(event: KeyboardEvent): void {
		const typing = isTyping(event.target);
		const command = event.metaKey || event.ctrlKey;

		if (command && event.key.toLowerCase() === 'k') {
			event.preventDefault();
			asking = !asking;
		} else if (!typing && command && event.key.toLowerCase() === 'z' && !event.shiftKey) {
			event.preventDefault();
			undo();
		} else if (
			!typing &&
			command &&
			((event.key.toLowerCase() === 'z' && event.shiftKey) || event.key.toLowerCase() === 'y')
		) {
			event.preventDefault();
			redo();
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
	<meta name="robots" content="noindex" />
</svelte:head>

<svelte:window
	{onkeydown}
	{onpaste}
	{ondragover}
	{ondrop}
	onfocusin={(event) => {
		keyboardUp = matchMedia('(pointer: coarse)').matches && opensKeyboard(event.target);
	}}
	onfocusout={() => (keyboardUp = false)}
	ondragleave={(event) => {
		if (event.relatedTarget === null) dropping = false;
	}}
/>

{#if bare}
	{@render children()}
{:else}
	<div class="relative flex h-dvh flex-col overflow-clip pt-safe">
		<header class="flex shrink-0 items-center gap-3 px-gutter pt-5 max-lg:flex-wrap">
			<a
				href={HOME}
				class="mr-1 shrink-0 text-ink-2 hover:text-ink {onTable ? 'max-sm:hidden' : ''}"
			>
				<Logo wordmark class="h-4 max-sm:hidden" />
				<Logo class="h-5 sm:hidden" />
			</a>
			<div class="flex min-w-0 items-center gap-3 max-lg:flex-1">
				{#if table !== undefined}
					<TableTitle {table} rows={rowCount} />
					<span class="shrink-0 pt-1 text-ink-3">{rowCount} {rowCount === 1 ? 'row' : 'rows'}</span>
				{:else if proposed !== undefined}
					<h1 class="min-w-0 truncate text-xl font-semibold tight max-sm:text-lg">{heading}</h1>
					<span class="shrink-0 pt-1 text-ink-3"
						>{proposed.rows}
						{proposed.rows === 1 ? 'row' : 'rows'}</span
					>
				{:else}
					<h1 class="min-w-0 truncate text-xl font-semibold tight max-sm:text-lg">{heading}</h1>
				{/if}
			</div>
			<SyncStatus />
			<div class="ml-auto flex shrink-0 items-center gap-1">
				<Button
					variant="ghost"
					class="w-control px-0"
					aria-label="Undo"
					title={app.history.at(-1)?.label}
					disabled={app.history.length === 0}
					onclick={undo}><Icon name="undo" /></Button
				>
				<Button
					variant="ghost"
					class="w-control px-0"
					aria-label="Redo"
					title={app.undone.at(-1)?.label}
					disabled={app.undone.length === 0}
					onclick={redo}><Icon name="redo" /></Button
				>
				{#if assistant.available && sync.status !== 'offline'}
					<Button
						variant="ghost"
						class={asking ? 'bg-tint-2 text-ink' : ''}
						aria-pressed={asking}
						onclick={() => (asking = !asking)}
						>Ask <span class="text-sm text-ink-3 max-sm:hidden">Ctrl K</span></Button
					>
				{/if}
				{#if !onSettings}
					<a
						href={SETTINGS}
						class="inline-flex h-control items-center rounded-box px-3 font-medium text-ink-2 transition-colors motion hover:bg-tint hover:text-ink {onTable
							? 'max-sm:hidden'
							: ''}">Settings</a
					>
				{/if}
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
					items={[
						...views.map((item) => ({
							id: item.id,
							label: item.name,
							href: tableUrl(table.id, item.id),
							active: item.id === view?.id
						})),
						...ghosts.map((item) => ({
							id: item.id,
							label: `${item.name} (proposed)`,
							href: tableUrl(table.id, item.id),
							active: item.id === view?.id
						}))
					]}
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
						class="ml-auto max-sm:w-control max-sm:px-0"
						aria-label="New row"
						onclick={() => {
							if (view?.type === 'grid') gridJump.blankRow += 1;
							else shell.newRow = true;
						}}
					>
						<Icon name="plus" class="size-4 sm:hidden" />
						<span class="max-sm:hidden">New row</span>
					</Button>
				{/if}
			</div>
		{/if}

		<div class="relative flex min-h-0 flex-1 px-gutter pt-3 pb-5 max-sm:px-0 max-sm:pb-0">
			<main
				class="isolate min-w-0 flex-1 overflow-auto rounded-panel bg-raised shadow-raised transition-[margin] motion-slow max-sm:rounded-none max-sm:bg-transparent max-sm:shadow-none {asking
					? 'lg:mr-ask-clear'
					: ''} {dropping ? 'ring-2 ring-ink ring-inset' : ''}"
			>
				{@render children()}
			</main>
			{#if assistant.available}
				<AskPanel bind:open={asking} table={table ?? proposed?.table ?? null} view={view ?? null} />
			{/if}
		</div>

		<div
			class="pointer-events-none absolute inset-x-gutter bottom-8 flex justify-center pb-safe transition-[right] motion-slow max-sm:bottom-3 {asking
				? 'lg:right-tabs-ask'
				: ''} {keyboardUp ? 'invisible' : ''}"
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
					})),
					...proposals.map(({ table: item }) => ({
						id: item.id,
						label: `${item.name} (proposed)`,
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
						onclick={() => startTable()}><Icon name="plus" /></button
					>
				{/snippet}
			</Segmented>
		</div>

		<Toast />
	</div>

	<ImportSheet />

	{#if table !== undefined}
		<TableMenu
			bind:open={menuOpen}
			{table}
			onviewsettings={proposedView ? undefined : () => (viewSettings = true)}
			onnewview={() => (viewCreating = true)}
		/>
		{#if !proposedView}
			<ViewSheet bind:open={viewSettings} tableId={table.id} viewId={view?.id ?? null} />
		{/if}
		<ViewSheet bind:open={viewCreating} tableId={table.id} />
		<RowSheet bind:open={shell.newRow} tableId={table.id} />
	{/if}
{/if}
