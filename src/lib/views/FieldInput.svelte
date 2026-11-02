<script lang="ts">
	import { app } from '#lib/client/app.svelte.ts';
	import { formatNumber, formatValue, readNumber } from '#lib/client/format.ts';
	import type { FieldDef, Value } from '#lib/core/model.ts';
	import { hasTime, parseDate } from '#lib/core/values.ts';
	import Select from '#lib/ui/Select.svelte';
	import { checkbox, input } from '#lib/ui/styles.ts';

	import { timedColumn } from './grid.ts';

	let {
		field,
		value = $bindable(),
		computed = null,
		id
	}: { field: FieldDef; value?: Value; computed?: Value; id?: string } = $props();

	let numberText = $state(typeof value === 'number' ? formatNumber(value, { edit: true }) : '');

	$effect(() => {
		const current = typeof value === 'number' ? value : null;
		if (readNumber(numberText) !== current) {
			numberText = current === null ? '' : formatNumber(current, { edit: true });
		}
	});

	let timed = $state(false);

	$effect.pre(() => {
		if (timed) return;
		void app.version;
		timed = hasTime(value) || timedColumn(app.ws, field);
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
			value = readNumber(numberText);
		}}
	/>
{:else if field.type === 'date'}
	<input
		{id}
		class={input}
		type={timed ? 'datetime-local' : 'date'}
		value={typeof value === 'string' ? (timed && !hasTime(value) ? `${value}T00:00` : value) : ''}
		oninput={(event) => (value = parseDate(event.currentTarget.value))}
	/>
{:else if field.type === 'choice'}
	<Select
		{id}
		options={[
			{ value: '', label: '' },
			...field.choices.map((choice) => ({
				value: choice.name,
				label: choice.name,
				color: choice.color ?? null
			}))
		]}
		value={typeof value === 'string' ? value : ''}
		placeholder={field.name}
		onchange={(picked) => (value = picked || null)}
	/>
{:else if field.type === 'check'}
	<input
		{id}
		type="checkbox"
		class={checkbox}
		checked={value === true}
		onchange={() => (value = value !== true)}
	/>
{:else if field.type === 'link'}
	<Select
		{id}
		options={[
			{ value: '', label: '' },
			...targets.map((target) => ({ value: target.id, label: target.title }))
		]}
		value={typeof value === 'string' ? value : ''}
		placeholder={field.name}
		onchange={(picked) => (value = picked || null)}
	/>
{:else if field.type === 'formula'}
	<p class="flex h-control items-center rounded-box bg-tint px-2 text-ink-2">
		{formatValue(field, computed ?? null)}
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
