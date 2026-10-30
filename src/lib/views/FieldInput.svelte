<script lang="ts">
	import { app } from '#lib/client/app.svelte.ts';
	import { formatNumber, formatValue } from '#lib/client/format.ts';
	import type { FieldDef, Value } from '#lib/core/model.ts';
	import { parseNumber } from '#lib/core/values.ts';
	import { input, select } from '#lib/ui/styles.ts';

	let {
		field,
		value = $bindable(),
		computed = null,
		id
	}: { field: FieldDef; value?: Value; computed?: Value; id?: string } = $props();

	let numberText = $state(typeof value === 'number' ? formatNumber(value) : '');

	$effect(() => {
		const current = typeof value === 'number' ? value : null;
		if (parseNumber(numberText) !== current) {
			numberText = current === null ? '' : formatNumber(current);
		}
	});

	const targets = $derived.by(() => {
		void app.version;
		if (field.type !== 'link' || field.target === null) {
			return [];
		}
		return app.ws
			.rows(field.target)
			.map((row) => ({ id: row.id, title: app.ws.rowTitle(row.id) || row.id }))
			.sort((a, b) => a.title.localeCompare(b.title));
	});
</script>

{#if field.type === 'number'}
	<input
		{id}
		class={input}
		inputmode="decimal"
		bind:value={numberText}
		oninput={() => (value = parseNumber(numberText))}
		placeholder="—"
	/>
{:else if field.type === 'date'}
	<input
		{id}
		class={input}
		type="date"
		value={typeof value === 'string' ? value.slice(0, 10) : ''}
		oninput={(event) => (value = event.currentTarget.value || null)}
	/>
{:else if field.type === 'choice'}
	<select
		{id}
		class={select}
		value={typeof value === 'string' ? value : ''}
		onchange={(event) => (value = event.currentTarget.value || null)}
	>
		<option value="">—</option>
		{#each field.choices as choice (choice.name)}
			<option value={choice.name}>{choice.name}</option>
		{/each}
	</select>
{:else if field.type === 'check'}
	<button
		{id}
		type="button"
		role="switch"
		aria-checked={value === true}
		aria-label={field.name}
		class="relative h-8 w-14 rounded-full transition-colors {value === true
			? 'bg-fill'
			: 'bg-sunken'}"
		onclick={() => (value = value !== true)}
	>
		<span
			class="absolute top-1 size-6 rounded-full bg-surface shadow transition-all {value === true
				? 'left-7'
				: 'left-1'}"
		></span>
	</button>
{:else if field.type === 'link'}
	<select
		{id}
		class={select}
		value={typeof value === 'string' ? value : ''}
		onchange={(event) => (value = event.currentTarget.value || null)}
	>
		<option value="">—</option>
		{#each targets as target (target.id)}
			<option value={target.id}>{target.title}</option>
		{/each}
	</select>
{:else if field.type === 'formula'}
	<p class="flex h-11 items-center rounded-xl bg-surface-2 px-3 text-[15px] text-ink-muted">
		{formatValue({ type: 'number' }, computed ?? null) || '—'}
	</p>
{:else}
	<input
		{id}
		class={input}
		value={typeof value === 'string' ? value : ''}
		oninput={(event) =>
			(value = event.currentTarget.value === '' ? null : event.currentTarget.value)}
	/>
{/if}
