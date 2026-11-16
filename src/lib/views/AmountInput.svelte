<script lang="ts">
	import { untrack } from 'svelte';

	import { affixes, bareText, currencyName, otherCurrency, readValue } from '#lib/client/format.ts';
	import { showToast } from '#lib/client/toast.svelte.ts';
	import type { FieldFormat, Value } from '#lib/core/model.ts';
	import { currencyOf } from '#lib/core/values.ts';
	import { grid as words } from '#lib/i18n/grid.ts';
	import AffixInput from '#lib/ui/AffixInput.svelte';

	let {
		field,
		value = $bindable(),
		id,
		label,
		placeholder
	}: {
		field: FieldFormat;
		value?: Value;
		id?: string;
		label?: string;
		placeholder?: string;
	} = $props();

	const shown = (current: Value | undefined): string =>
		typeof current === 'number' ? bareText(field, current) : '';

	let text = $state(shown(value));

	const foreign = $derived(field.type === 'currency' && otherCurrency(text, currencyOf(field)));

	$effect(() => {
		if (foreign) untrack(() => showToast(words.otherCurrency(currencyName(currencyOf(field)))));
	});

	$effect(() => {
		const current = typeof value === 'number' ? value : null;
		if (!foreign && (readValue(field, text) ?? null) !== current) text = shown(current);
	});

	const marks = $derived(affixes(field));
</script>

<AffixInput
	{id}
	aria-label={label}
	prefix={marks.prefix}
	suffix={marks.suffix}
	inputmode="decimal"
	autocomplete="off"
	{placeholder}
	value={text}
	aria-invalid={foreign || undefined}
	oninput={(event) => {
		text = event.currentTarget.value;
		if (!foreign) value = readValue(field, text) ?? null;
	}}
/>
