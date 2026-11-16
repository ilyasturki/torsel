<script lang="ts">
	import { app } from '#lib/client/app.svelte.ts';
	import Chart from '#lib/views/Chart.svelte';
	import Entry from '#lib/views/Entry.svelte';
	import Grid from '#lib/views/Grid.svelte';
	import List from '#lib/views/List.svelte';

	let { tableId, viewId }: { tableId: string; viewId: string | undefined } = $props();

	const view = $derived.by(() => {
		void app.version;
		const views = app.ws.views(tableId);
		return views.find((item) => item.id === viewId) ?? views[0];
	});
</script>

{#if view !== undefined}
	{#key view.id}
		<div class="h-full enter">
			{#if view.type === 'grid'}
				<Grid {tableId} {view} />
			{:else if view.type === 'entry'}
				<Entry {tableId} {view} />
			{:else if view.type === 'list'}
				<List {tableId} {view} />
			{:else}
				<Chart {tableId} {view} still />
			{/if}
		</div>
	{/key}
{/if}
