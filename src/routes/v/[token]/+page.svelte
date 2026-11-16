<script lang="ts">
	import { onMount } from 'svelte';

	import { page } from '$app/state';

	import { ApiError, request } from '#lib/client/api.ts';
	import { app } from '#lib/client/app.svelte.ts';
	import { imagesFromLink } from '#lib/client/images.svelte.ts';
	import type { Published } from '#lib/core/published.ts';
	import { publish as words } from '#lib/i18n/publish.ts';
	import { viewName } from '#lib/i18n/names.ts';
	import Empty from '#lib/ui/Empty.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import Logo from '#lib/ui/Logo.svelte';
	import Chart from '#lib/views/Chart.svelte';
	import Grid from '#lib/views/Grid.svelte';
	import List from '#lib/views/List.svelte';

	let shown = $state.raw<Published | null>(null);
	let failed = $state<string | null>(null);

	const view = $derived.by(() => {
		void app.version;
		return shown === null ? undefined : app.ws.view(shown.view.id);
	});

	onMount(async () => {
		const token = page.params.token ?? '';
		try {
			const published = await request<Published>('/api/published', {
				method: 'POST',
				body: { token }
			});
			imagesFromLink(token);
			app.openPublished(published);
			shown = published;
		} catch (error) {
			failed = error instanceof ApiError && error.status === 404 ? words.gone : words.loadFailed;
		}
	});
</script>

<svelte:head>
	<title>{shown === null ? 'Torsel' : `${viewName(shown.view)} · ${shown.table.name}`}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="flex h-dvh flex-col overflow-clip pt-safe">
	{#if failed !== null}
		<Empty text={failed} />
	{:else if shown !== null && view !== undefined}
		<header class="flex min-h-13 shrink-0 items-center gap-3 px-gutter py-2.5">
			<p class="flex min-w-0 flex-1 items-center gap-1 text-ink-3">
				<span class="truncate max-sm:hidden">{shown.base.name}</span>
				<Icon name="chevron" class="size-3 shrink-0 max-sm:hidden" />
				<span class="truncate">{shown.table.name}</span>
				<Icon name="chevron" class="size-3 shrink-0" />
				<span class="truncate font-medium text-ink">{viewName(shown.view)}</span>
			</p>
			<a
				href="/"
				data-sveltekit-reload
				class="flex shrink-0 items-center gap-2 text-sm text-ink-3 transition-colors motion hover:text-ink"
			>
				<Logo class="size-3" />
				{words.madeWith}
			</a>
		</header>
		<div class="flex min-h-0 flex-1 px-gutter pt-3 pb-5 max-sm:p-0 max-sm:pb-safe">
			<main
				class="min-w-0 flex-1 overflow-auto rounded-panel bg-raised ring-1 ring-frame max-sm:rounded-none max-sm:ring-0"
			>
				{#if view.type === 'grid'}
					<Grid tableId={shown.table.id} {view} />
				{:else if view.type === 'list'}
					<List tableId={shown.table.id} {view} />
				{:else}
					<Chart tableId={shown.table.id} {view} />
				{/if}
			</main>
		</div>
	{/if}
</div>
