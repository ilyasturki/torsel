<script lang="ts">
	import Icon from './Icon.svelte';

	let {
		label,
		text,
		ghost = false,
		size = 'md',
		oninput,
		onstep
	}: {
		label: string;
		text: string;
		ghost?: boolean;
		size?: 'sm' | 'md' | 'lg';
		oninput: (text: string) => void;
		onstep: (direction: 1 | -1) => void;
	} = $props();

	const sizes = {
		sm: 'h-16 text-xl',
		md: 'h-20 text-hero',
		lg: 'h-28 text-hero-lg'
	};
	const side =
		'motion flex w-18 shrink-0 items-center justify-center rounded-box text-ink transition-colors hover:bg-tint-2';
</script>

<div class="flex rounded-box bg-tint {sizes[size]}">
	<button type="button" class={side} aria-label="{label} minus" onclick={() => onstep(-1)}>
		<Icon name="minus" class="size-5" />
	</button>
	<label class="relative flex min-w-0 flex-1 items-center justify-center">
		<span class="absolute inset-x-0 top-2 text-center text-sm font-medium text-ink-3">{label}</span>
		<input
			class="w-full min-w-0 bg-transparent pt-3 text-center leading-none font-semibold tighter outline-none {ghost
				? 'text-ink-2'
				: 'text-ink'}"
			inputmode="decimal"
			aria-label={label}
			value={text}
			oninput={(event) => oninput(event.currentTarget.value)}
		/>
	</label>
	<button type="button" class={side} aria-label="{label} plus" onclick={() => onstep(1)}>
		<Icon name="plus" class="size-5" />
	</button>
</div>
