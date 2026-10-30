<script lang="ts">
	import { app } from '#lib/client/app.svelte.ts';
	import { formatNumber, formatValue } from '#lib/client/format.ts';
	import type { FieldDef, Value } from '#lib/core/model.ts';
	import { parseNumber } from '#lib/core/values.ts';
	import { checkbox, input, select } from '#lib/ui/styles.ts';

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
		value={numberText}
		oninput={(event) => {
			numberText = event.currentTarget.value;
			value = parseNumber(numberText);
		}}
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
		<option value=""></option>
		{#each field.choices as choice (choice.name)}
			<option value={choice.name}>{choice.name}</option>
		{/each}
	</select>
{:else if field.type === 'check'}
	<input
		{id}
		type="checkbox"
		class={checkbox}
		checked={value === true}
		onchange={() => (value = value !== true)}
	/>
{:else if field.type === 'link'}
	<select
		{id}
		class={select}
		value={typeof value === 'string' ? value : ''}
		onchange={(event) => (value = event.currentTarget.value || null)}
	>
		<option value=""></option>
		{#each targets as target (target.id)}
			<option value={target.id}>{target.title}</option>
		{/each}
	</select>
{:else if field.type === 'formula'}
	<p class="flex h-control items-center rounded-box bg-tint px-2 text-ink-2">
		{formatValue({ type: 'number' }, computed ?? null)}
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
