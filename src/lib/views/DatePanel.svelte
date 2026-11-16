<script lang="ts">
	import { untrack } from 'svelte';

	import { editText, readValue } from '#lib/client/format.ts';
	import type { FieldFormat, Value } from '#lib/core/model.ts';
	import Calendar from '#lib/ui/Calendar.svelte';
	import { input } from '#lib/ui/styles.ts';

	import { dayPicked } from './dates.ts';
	import { stampOf, stampText } from './stamp.ts';

	let {
		field,
		label,
		value,
		seed = '',
		onchoose
	}: {
		field: FieldFormat;
		label: string;
		value: Value | undefined;
		seed?: string;
		onchoose: (value: Value) => void;
	} = $props();

	let text = $state(
		untrack(() => seed || (typeof value === 'string' ? editText(field, value) : ''))
	);
	const read = $derived(readValue(field, text));
	const day = $derived(typeof read === 'string' ? read : typeof value === 'string' ? value : null);

	function onkeydown(event: KeyboardEvent): void {
		const kind = stampOf(event);
		if (kind !== null) {
			const stamp = stampText(field, kind === 'time');
			if (stamp === null) return;
			event.preventDefault();
			onchoose(readValue(field, stamp) ?? null);
		} else if (event.key === 'Enter' && read !== undefined) {
			event.preventDefault();
			onchoose(read);
		}
	}
</script>

<div class="flex flex-col gap-3">
	<input
		class="{input} h-11 text-lg"
		aria-label={label}
		placeholder={label}
		autocomplete="off"
		enterkeyhint="done"
		aria-invalid={(text.trim() !== '' && read === undefined) || undefined}
		bind:value={text}
		{onkeydown}
	/>
	<Calendar large value={day} onpick={(picked) => onchoose(dayPicked(field, value, picked))} />
</div>
