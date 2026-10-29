<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	let {
		variant = 'secondary',
		size = 'md',
		class: extra = '',
		children,
		...rest
	}: HTMLButtonAttributes & {
		variant?: 'primary' | 'secondary' | 'ghost';
		size?: 'sm' | 'md' | 'lg';
		children: Snippet;
	} = $props();

	const variants = {
		primary: 'bg-fill text-on-fill hover:opacity-90',
		secondary: 'border border-line bg-surface text-ink hover:bg-hover',
		ghost: 'text-ink hover:bg-hover'
	};

	const sizes = {
		sm: 'h-9 px-3 text-sm',
		md: 'h-11 px-4 text-[15px]',
		lg: 'h-14 px-5 text-base'
	};
</script>

<button
	type="button"
	class="inline-flex items-center justify-center gap-2 rounded-xl font-semibold whitespace-nowrap transition-opacity disabled:opacity-40 {variants[
		variant
	]} {sizes[size]} {extra}"
	{...rest}
>
	{@render children()}
</button>
