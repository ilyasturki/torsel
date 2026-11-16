<script lang="ts">
	import { app } from '#lib/client/app.svelte.ts';
	import { applyWithUndo } from '#lib/client/toast.svelte.ts';
	import { updateRecord } from '#lib/core/actions.ts';
	import type { ColorRule, Condition } from '#lib/core/conditions.ts';
	import type { Value, ViewConfig } from '#lib/core/model.ts';
	import { rules as words } from '#lib/i18n/rules.ts';

	import ColorRules from './ColorRules.svelte';
	import FilterList from './FilterList.svelte';

	let { viewId, kind }: { viewId: string; kind: 'filter' | 'colors' } = $props();

	const view = $derived.by(() => {
		void app.version;
		return app.ws.view(viewId);
	});

	function save(patch: ViewConfig, label: string): void {
		if (view === undefined) return;
		const config = JSON.parse(JSON.stringify({ ...view.config, ...patch })) as Value;
		applyWithUndo(updateRecord(app.ws, view.id, { config }), label);
	}
</script>

{#if view !== undefined}
	{#if kind === 'filter'}
		<FilterList
			tableId={view.table}
			filters={view.config.filters ?? []}
			onchange={(filters: Condition[]) =>
				save({ filters }, filters.length === 0 ? words.filtersCleared : words.filtersChanged)}
		/>
	{:else}
		<ColorRules
			tableId={view.table}
			rules={view.config.colors ?? []}
			onchange={(colors: ColorRule[]) => save({ colors }, words.colorsChanged)}
		/>
	{/if}
{/if}
