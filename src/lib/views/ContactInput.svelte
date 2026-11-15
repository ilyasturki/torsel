<script lang="ts">
	import type { FieldFormat, Value } from '#lib/core/model.ts';
	import { coerce, hrefOf } from '#lib/core/values.ts';
	import { fields as words } from '#lib/i18n/fields.ts';
	import AffixInput from '#lib/ui/AffixInput.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import { focus } from '#lib/ui/styles.ts';

	let {
		field,
		value = $bindable(),
		id,
		label,
		placeholder
	}: {
		field: FieldFormat & { type: 'url' | 'email' | 'phone' };
		value?: Value;
		id?: string;
		label?: string;
		placeholder?: string;
	} = $props();

	const INPUT = { url: 'url', email: 'email', phone: 'tel' } as const;
	const open = $derived(
		{ url: words.openLink, email: words.writeEmail, phone: words.call }[field.type]
	);

	let text = $state(typeof value === 'string' ? value : '');

	$effect(() => {
		const current = typeof value === 'string' ? value : null;
		if ((coerce(field, text) ?? null) !== current) text = current ?? '';
	});

	const valid = $derived(typeof value === 'string' && coerce(field, value) !== null);
</script>

<AffixInput
	{id}
	aria-label={label}
	type={INPUT[field.type]}
	autocomplete="off"
	{placeholder}
	value={text}
	oninput={(event) => {
		text = event.currentTarget.value;
		value = coerce(field, text);
	}}
>
	{#snippet end()}
		{#if valid && typeof value === 'string'}
			<a
				href={hrefOf(field.type, value)}
				target={field.type === 'url' ? '_blank' : undefined}
				rel="noopener noreferrer"
				class="mr-1 inline-flex size-6 shrink-0 items-center justify-center rounded-box text-ink-2 transition-colors motion hover:bg-tint-2 hover:text-ink {focus}"
				aria-label={open}
				title={open}
			>
				<Icon name="open" />
			</a>
		{/if}
	{/snippet}
</AffixInput>
