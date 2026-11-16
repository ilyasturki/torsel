<script lang="ts">
	import { untrack } from 'svelte';

	import { editText, readValue } from '#lib/client/format.ts';
	import type { FieldFormat, Value } from '#lib/core/model.ts';
	import Stepper from '#lib/ui/Stepper.svelte';

	import { durationStep } from './dates.ts';

	let {
		field,
		label,
		value = $bindable(),
		id,
		size = 'xs',
		onenter
	}: {
		field: FieldFormat;
		label: string;
		value?: Value;
		id?: string;
		size?: 'xs' | 'sm';
		onenter?: () => void;
	} = $props();

	const shown = (current: Value | undefined): string =>
		typeof current === 'number' ? editText(field, current) : '';

	let text = $state(shown(value));
	let mine: Value = untrack(() => value ?? null);

	$effect(() => {
		const current = value ?? null;
		untrack(() => {
			if (current !== mine) text = shown(current);
			mine = current;
		});
	});

	function put(next: Value): void {
		mine = next;
		value = next;
	}

	function step(direction: 1 | -1): void {
		const next = durationStep(readValue(field, text) ?? value, direction);
		put(next);
		text = shown(next);
	}
</script>

<Stepper
	{id}
	{label}
	{size}
	full
	{text}
	inputmode="text"
	placeholder={field.seconds ? 'h:mm:ss' : 'h:mm'}
	invalid={text.trim() !== '' && readValue(field, text) === undefined}
	oninput={(typed) => {
		text = typed;
		const next = readValue(field, typed);
		if (next !== undefined) put(next);
	}}
	onstep={step}
	onkeydown={(event) => {
		if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
			event.preventDefault();
			step(event.key === 'ArrowUp' ? 1 : -1);
		} else if (event.key === 'Enter') {
			onenter?.();
		}
	}}
	onblur={() => (text = shown(value))}
/>
