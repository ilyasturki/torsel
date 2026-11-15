<script lang="ts">
	import Icon from './Icon.svelte';
	import { fieldFill, fieldFocusWithin } from './styles.ts';

	let {
		label,
		text,
		size = 'md',
		oninput,
		onstep
	}: {
		label: string;
		text: string;
		size?: 'xs' | 'sm' | 'md' | 'lg';
		oninput: (text: string) => void;
		onstep: (direction: 1 | -1) => void;
	} = $props();

	const sizes = {
		xs: 'h-control w-36 font-medium',
		sm: 'h-16 text-xl',
		md: 'h-20 text-hero',
		lg: 'h-28 text-hero-lg'
	};
	const sides = { xs: 'w-control', sm: 'w-11', md: 'w-18', lg: 'w-18' };
	const side = $derived(
		`motion flex ${sides[size]} shrink-0 items-center justify-center rounded-box text-ink transition-colors hover:bg-tint-2`
	);
	const icon = $derived(size === 'xs' ? 'size-4 text-ink-2' : 'size-5');
</script>

<div class="flex rounded-box {fieldFill} {fieldFocusWithin} {sizes[size]}">
	<button type="button" class={side} aria-label="{label} minus" onclick={() => onstep(-1)}>
		<Icon name="minus" class={icon} />
	</button>
	<label class="relative flex min-w-0 flex-1 items-center justify-center">
		{#if size !== 'xs'}
			<span
				class="absolute inset-x-0 top-2 truncate px-1 text-center text-sm font-medium text-ink-3"
				>{label}</span
			>
		{/if}
		<input
			class="w-full min-w-0 bg-transparent text-center leading-none tighter text-ink outline-none {size ===
			'xs'
				? ''
				: 'pt-3 font-semibold'}"
			inputmode="decimal"
			aria-label={label}
			value={text}
			oninput={(event) => oninput(event.currentTarget.value)}
		/>
	</label>
	<button type="button" class={side} aria-label="{label} plus" onclick={() => onstep(1)}>
		<Icon name="plus" class={icon} />
	</button>
</div>
