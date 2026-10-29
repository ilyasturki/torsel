<script lang="ts">
	import Check from '@lucide/svelte/icons/check';

	import { app } from '#lib/client/app.svelte.ts';
	import { formatValue } from '#lib/client/format.ts';
	import type { FieldDef, Value } from '#lib/core/model.ts';
	import Chip from '#lib/ui/Chip.svelte';

	let { field, value }: { field: FieldDef; value: Value | undefined } = $props();

	const color = $derived(
		field.type === 'choice' && typeof value === 'string'
			? (field.choices.find((choice) => choice.name === value)?.color ?? null)
			: null
	);

	const title = $derived.by(() => {
		void app.version;
		return field.type === 'link' && typeof value === 'string' ? app.ws.rowTitle(value) : '';
	});
</script>

{#if value === null || value === undefined || value === ''}
	<span class="text-ink-faint">—</span>
{:else if field.type === 'choice'}
	<Chip name={String(value)} {color} />
{:else if field.type === 'check'}
	{#if value === true || value === 1}
		<Check class="size-4" aria-label="oui" />
	{:else}
		<span class="text-ink-faint">—</span>
	{/if}
{:else if field.type === 'link'}
	<span class="truncate">{title || '—'}</span>
{:else}
	<span class="truncate">{formatValue(field, value)}</span>
{/if}
