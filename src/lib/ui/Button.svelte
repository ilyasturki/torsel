<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	import { focus, secondary } from './styles.ts';

	let {
		variant = 'secondary',
		size = 'md',
		class: extra = '',
		children,
		...rest
	}: HTMLButtonAttributes & {
		variant?: 'primary' | 'secondary' | 'ghost';
		size?: 'md' | 'cta';
		children: Snippet;
	} = $props();

	const variants = {
		primary: 'bg-accent text-on-accent hover:opacity-90 disabled:bg-tint-2 disabled:text-ink-3',
		secondary: `${secondary} disabled:text-ink-3`,
		ghost: 'text-ink-2 hover:bg-tint hover:text-ink disabled:text-ink-3'
	};

	const sizes = {
		md: 'h-control px-3',
		cta: 'h-cta px-4 text-lg font-semibold'
	};
</script>

<button
	type="button"
	class="inline-flex items-center justify-center gap-2 rounded-box font-medium whitespace-nowrap transition-colors motion {focus} {variants[
		variant
	]} {sizes[size]} {extra}"
	{...rest}
>
	{@render children()}
</button>
