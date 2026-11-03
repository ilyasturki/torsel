<script lang="ts">
	import { affixes, bareText, readValue } from '#lib/client/format.ts';
	import type { FieldFormat, Value } from '#lib/core/model.ts';
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

	$effect(() => {
		const current = typeof value === 'number' ? value : null;
		if ((readValue(field, text) ?? null) !== current) text = shown(current);
	});

	const marks = $derived(affixes(field));
</script>

<AffixInput
	{id}
	aria-label={label}
	prefix={marks.prefix}
	suffix={marks.suffix}
	inputmode={field.type === 'duration' ? undefined : 'decimal'}
	autocomplete="off"
	placeholder={placeholder ??
		(field.type === 'duration' ? (field.seconds ? 'h:mm:ss' : 'h:mm') : '')}
	value={text}
	oninput={(event) => {
		text = event.currentTarget.value;
		value = readValue(field, text) ?? null;
	}}
/>
