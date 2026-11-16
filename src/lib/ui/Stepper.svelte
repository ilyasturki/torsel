<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';

	import { ui as words } from '#lib/i18n/ui.ts';

	import Icon from './Icon.svelte';
	import { fieldFill, fieldFocusWithin } from './styles.ts';

	let {
		label,
		text,
		size = 'md',
		full = false,
		caption = true,
		id,
		placeholder,
		inputmode = 'decimal',
		invalid = false,
		oninput,
		onstep,
		onkeydown,
		onblur
	}: {
		label: string;
		text: string;
		size?: 'xs' | 'sm' | 'md' | 'lg';
		full?: boolean;
		/** The label above the number, from `sm` up; off where a title already names it. */
		caption?: boolean;
		id?: string;
		placeholder?: string;
		inputmode?: HTMLInputAttributes['inputmode'];
		invalid?: boolean;
		oninput: (text: string) => void;
		onstep: (direction: 1 | -1) => void;
		onkeydown?: (event: KeyboardEvent) => void;
		onblur?: () => void;
	} = $props();

	const sizes = $derived({
		xs: `h-control font-medium ${full ? 'w-full' : 'w-36'}`,
		sm: 'h-16 text-xl',
		md: 'h-20 text-hero',
		lg: 'h-28 text-hero-lg'
	});
	const sides = { xs: 'w-control', sm: 'w-11', md: 'w-18', lg: 'w-18' };
	const side = $derived(
		`motion flex ${sides[size]} shrink-0 items-center justify-center rounded-box text-ink transition-colors hover:bg-tint-2`
	);
	const icon = $derived(size === 'xs' ? 'size-4 text-ink-2' : 'size-5');
</script>

<div class="flex rounded-box {fieldFill} {fieldFocusWithin} {sizes[size]}">
	<button type="button" class={side} aria-label={words.minus(label)} onclick={() => onstep(-1)}>
		<Icon name="minus" class={icon} />
	</button>
	<label class="relative flex min-w-0 flex-1 items-center justify-center">
		{#if size !== 'xs' && caption}
			<span
				class="absolute inset-x-0 top-2 truncate px-1 text-center text-sm font-medium text-ink-3"
				>{label}</span
			>
		{/if}
		<input
			class="w-full min-w-0 bg-transparent text-center leading-none tighter text-ink outline-none placeholder:text-ink-3 {size ===
			'xs'
				? ''
				: caption
					? 'pt-3 font-semibold'
					: 'font-semibold'}"
			{id}
			{inputmode}
			{placeholder}
			autocomplete="off"
			aria-label={label}
			aria-invalid={invalid || undefined}
			value={text}
			oninput={(event) => oninput(event.currentTarget.value)}
			{onkeydown}
			{onblur}
		/>
	</label>
	<button type="button" class={side} aria-label={words.plus(label)} onclick={() => onstep(1)}>
		<Icon name="plus" class={icon} />
	</button>
</div>
