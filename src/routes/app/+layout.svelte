<script lang="ts">
	import { onMount } from 'svelte';

	import { dev } from '$app/env';
	import { afterNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';

	import { app } from '#lib/client/app.svelte.ts';
	import { assistant, checkAvailability, resumeThread } from '#lib/client/assistant.svelte.ts';
	import { tableBySlug, viewBySlug } from '#lib/client/directory.svelte.ts';
	import { gridJump } from '#lib/client/grid.svelte.ts';
	import { AUTHORIZE, HOME, LOGIN, SETTINGS, tableUrl } from '#lib/client/nav.ts';
	import { visitTable } from '#lib/client/place.ts';
	import { me } from '#lib/client/session.svelte.ts';
	import { isTyping, pastedCells, shell } from '#lib/client/shell.svelte.ts';
	import { followOtherTabs, sync } from '#lib/client/sync.svelte.ts';
	import { redoChange, undoChange } from '#lib/client/toast.svelte.ts';
	import { common } from '#lib/i18n/common.ts';
	import { markDocumentLocale } from '#lib/i18n/runtime.ts';
	import { shell as words } from '#lib/i18n/shell.ts';
	import Button from '#lib/ui/Button.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import IconButton from '#lib/ui/IconButton.svelte';
	import { keys } from '#lib/ui/keys.ts';
	import Logo from '#lib/ui/Logo.svelte';
	import { focus, secondary } from '#lib/ui/styles.ts';
	import Tooltip from '#lib/ui/Tooltip.svelte';
	import AskPanel from '#lib/views/AskPanel.svelte';
	import ImportSheet from '#lib/views/ImportSheet.svelte';
	import { shownView } from '#lib/views/pin.svelte.ts';
	import RowSheet from '#lib/views/RowSheet.svelte';
	import SyncStatus from '#lib/views/SyncStatus.svelte';
	import TableMenu from '#lib/views/TableMenu.svelte';
	import TableSwitcher from '#lib/views/TableSwitcher.svelte';
	import TableTitle from '#lib/views/TableTitle.svelte';
	import Toast from '#lib/views/Toast.svelte';
	import ViewSheet from '#lib/views/ViewSheet.svelte';
	import ViewTabs from '#lib/views/ViewTabs.svelte';

	let { children } = $props();

	markDocumentLocale();

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

	const bare = $derived(
		page.url.pathname === LOGIN ||
			page.url.pathname.startsWith(`${LOGIN}/`) ||
			page.url.pathname === AUTHORIZE
	);
	const onSettings = $derived(page.url.pathname === SETTINGS);

	let beforeSettings = $state(HOME);

	afterNavigate(({ from, to }) => {
		const was = from?.url;
		if (to?.url?.pathname === SETTINGS && was && was.pathname !== SETTINGS) {
			beforeSettings = was.pathname + was.search;
		}
	});
	const tableId = $derived(
		page.params.table === undefined ? null : (tableBySlug(page.params.table) ?? null)
	);

	const table = $derived.by(() => {
		void app.version;
		return tableId === null ? undefined : app.ws.table(tableId);
	});

	const views = $derived.by(() => {
		void app.version;
		return table === undefined ? [] : app.ws.views(table.id);
	});

	const adds = $derived.by(() => {
		void app.version;
		return table !== undefined && app.canAddRows(table.id);
	});

	const view = $derived.by(() => {
		if (table === undefined) return undefined;
		const segment = page.params.view;
		const requested = segment === undefined ? undefined : viewBySlug(table.id, segment);
		return shownView(table.id, views, requested);
	});

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
		if (table !== undefined && view !== undefined) {
			visitTable(table.id, view.id);
		}
	});

	const onTable = $derived(table !== undefined);

	const rowCount = $derived.by(() => {
		void app.version;
		return table === undefined ? 0 : app.ws.rows(table.id).length;
	});

	const heading = $derived(table?.name ?? (onSettings ? words.settings : words.tables));

	let asking = $state(false);
	let menuOpen = $state(false);
	let menuAnchor = $state<HTMLElement | null>(null);
	let viewSettings = $state(false);
	let settingsView = $state<string | null>(null);

	function openViewSettings(viewId: string | null): void {
		settingsView = viewId;
		viewSettings = true;
	}
	let dropping = $state(false);

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
		} else if (command && !event.altKey && event.key.toLowerCase() === 'p') {
			event.preventDefault();
			shell.switching = !shell.switching;
		} else if (!typing && command && event.key.toLowerCase() === 'z' && !event.shiftKey) {
			event.preventDefault();
			undoChange();
		} else if (
			!typing &&
			command &&
			((event.key.toLowerCase() === 'z' && event.shiftKey) || event.key.toLowerCase() === 'y')
		) {
			event.preventDefault();
			redoChange();
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
	<title>{table === undefined && !onSettings ? 'Torsel' : `${heading} · Torsel`}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<svelte:window
	{onkeydown}
	{onpaste}
	{ondragover}
	{ondrop}
	ondragleave={(event) => {
		if (event.relatedTarget === null) dropping = false;
	}}
/>

{#if bare}
	{@render children()}
{:else}
	<div class="relative flex h-dvh flex-col overflow-clip pt-safe">
		<header
			class="flex min-h-13 shrink-0 items-center gap-x-3 gap-y-1 px-gutter py-2.5 max-lg:flex-wrap max-sm:gap-x-2 max-sm:pr-2"
		>
			<a
				href={HOME}
				class="shrink-0 rounded-box text-ink transition-colors motion hover:text-ink-2"
				aria-label={words.allTables}
			>
				<Logo class="size-4" />
			</a>
			<div class="flex min-w-0 items-center gap-2 max-lg:flex-1">
				{#if table !== undefined}
					<TableTitle {table} rows={rowCount} />
				{:else}
					<h1 class="flex min-w-0" aria-label={heading}>
						<TableSwitcher name={heading} current={null} />
					</h1>
				{/if}
				{#if table !== undefined}
					<span class="shrink-0 text-ink-3">{words.rowCount(rowCount)}</span>
				{/if}
			</div>
			<SyncStatus />
			<div class="ml-auto flex shrink-0 items-center gap-1">
				{#if assistant.available && sync.status !== 'offline'}
					<Tooltip shortcut={keys('mod', 'k')}>
						{#snippet children(props)}
							<Button
								{...props}
								class={asking ? 'bg-button-hover' : ''}
								aria-pressed={asking}
								onclick={() => (asking = !asking)}>{words.ask}</Button
							>
						{/snippet}
					</Tooltip>
				{/if}
				<a
					href={onSettings ? beforeSettings : SETTINGS}
					class="inline-grid h-control items-center rounded-box px-3 font-medium transition-colors motion {secondary} {focus} {onTable
						? 'max-sm:hidden'
						: ''}"
					onclick={(event) => {
						// The second click of a double-click lands here once Settings has opened.
						if (onSettings && event.detail > 1) event.preventDefault();
					}}
				>
					<span class="col-start-1 row-start-1 {onSettings ? 'invisible' : ''}"
						>{words.settings}</span
					>
					<span class="col-start-1 row-start-1 {onSettings ? '' : 'invisible'}">{common.back}</span>
				</a>
				{#if table !== undefined}
					<IconButton
						icon="more"
						label={common.more}
						tooltip={false}
						class="sm:hidden"
						onclick={() => (menuOpen = true)}
					/>
				{/if}
			</div>
		</header>

		{#if table !== undefined}
			<div class="flex shrink-0 items-center gap-1 border-b border-rule px-gutter max-sm:pr-2">
				<ViewTabs {table} {views} current={view} onsettings={openViewSettings} />
				<IconButton
					icon="more"
					label={common.more}
					class="max-sm:hidden"
					onclick={(event) => {
						menuAnchor = event.currentTarget;
						menuOpen = !menuOpen;
					}}
				/>
				{#if view?.type !== 'entry' && adds}
					<Button
						variant="primary"
						class="ml-auto max-sm:w-control max-sm:px-0"
						aria-label={words.newRow}
						onclick={() => {
							if (view?.type === 'grid') gridJump.blankRow += 1;
							else shell.newRow = true;
						}}
					>
						<Icon name="plus" class="size-4 sm:hidden" />
						<span class="max-sm:hidden">{words.newRow}</span>
					</Button>
				{/if}
			</div>
		{/if}

		<div class="relative flex min-h-0 flex-1 px-gutter pt-3 pb-5 max-sm:p-0 max-sm:pb-safe">
			<main
				class="isolate min-w-0 flex-1 overflow-auto rounded-panel bg-raised transition-[margin] motion-slow max-sm:rounded-none {asking
					? 'lg:mr-ask-clear'
					: ''} {dropping ? 'ring-2 ring-accent ring-inset' : 'ring-1 ring-frame max-sm:ring-0'}"
			>
				{@render children()}
			</main>
			{#if assistant.available}
				<AskPanel bind:open={asking} table={table ?? null} view={view ?? null} />
			{/if}
		</div>

		<Toast />
	</div>

	<ImportSheet />

	{#if table !== undefined}
		<TableMenu
			bind:open={menuOpen}
			anchor={menuAnchor}
			{table}
			{view}
			onviewsettings={() => openViewSettings(view?.id ?? null)}
		/>
		{#if settingsView !== null}
			<ViewSheet bind:open={viewSettings} tableId={table.id} viewId={settingsView} />
		{/if}
		<RowSheet bind:open={shell.newRow} tableId={table.id} />
	{/if}
{/if}
