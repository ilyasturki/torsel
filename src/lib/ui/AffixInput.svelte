<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLInputAttributes } from 'svelte/elements';

	import { fieldFill, fieldFocusWithin } from './styles.ts';

	let {
		value = $bindable(''),
		ref = $bindable(),
		prefix = '',
		suffix = '',
		end,
		class: extra = '',
		...rest
	}: Omit<HTMLInputAttributes, 'value'> & {
		value?: string;
		ref?: HTMLInputElement;
		prefix?: string;
		suffix?: string;
		end?: Snippet;
	} = $props();
</script>

<span
	class="flex h-control w-full min-w-0 items-center rounded-box text-ink transition-colors motion {fieldFill} {fieldFocusWithin} {extra}"
>
	{#if prefix}
		<span class="shrink-0 pl-2 text-ink-3" aria-hidden="true">{prefix}</span>
	{/if}
	<input
		bind:this={ref}
		bind:value
		class="h-full min-w-0 flex-1 bg-transparent px-2 outline-none placeholder:text-ink-3 {prefix
			? 'pl-1'
			: ''} {suffix ? 'pr-1' : ''}"
		{...rest}
	/>
	{#if suffix}
		<span class="shrink-0 pr-2 text-ink-3" aria-hidden="true">{suffix}</span>
	{/if}
	{@render end?.()}
</span>
