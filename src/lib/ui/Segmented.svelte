<script lang="ts" module>
	export type SegmentedItem = {
		id: string;
		label: string;
		href?: string;
		active?: boolean;
		onclick?: () => void;
	};
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		items,
		label,
		tone = 'inset',
		class: extra = '',
		after
	}: {
		items: SegmentedItem[];
		label: string;
		tone?: 'inset' | 'float';
		class?: string;
		after?: Snippet;
	} = $props();

	function slide(node: HTMLElement): { destroy(): void } {
		const indicator = node.querySelector<HTMLElement>('[data-indicator]');
		const move = (): void => {
			const on = node.querySelector<HTMLElement>('[data-on="true"]');
			if (indicator === null) return;
			indicator.style.opacity = on === null ? '0' : '1';
			if (on !== null) {
				indicator.style.width = `${on.offsetWidth}px`;
				indicator.style.transform = `translateX(${on.offsetLeft}px)`;
			}
		};
		const mutations = new MutationObserver(move);
		mutations.observe(node, {
			subtree: true,
			childList: true,
			attributes: true,
			attributeFilter: ['data-on']
		});
		const sizes = new ResizeObserver(move);
		sizes.observe(node);
		move();
		return {
			destroy() {
				mutations.disconnect();
				sizes.disconnect();
			}
		};
	}

	const shell = {
		inset: 'bg-tint rounded-panel p-0.5',
		float: 'bg-float shadow-float rounded-panel p-1'
	};
	const thumb = { inset: 'bg-float shadow-raised', float: 'bg-tint-2' };
</script>

<div
	class="relative inline-flex max-w-full hide-scrollbar overflow-x-auto {shell[tone]} {extra}"
	role="group"
	aria-label={label}
	use:slide
>
	<i
		data-indicator
		class="pointer-events-none absolute top-0 left-0 h-control rounded-box transition-[transform,width] motion-slow {thumb[
			tone
		]} {tone === 'inset' ? 'mt-0.5' : 'mt-1'}"
	></i>
	{#each items as item (item.id)}
		{#if item.href !== undefined}
			<a
				href={item.href}
				class="relative flex h-control shrink-0 items-center px-3 font-medium whitespace-nowrap transition-colors motion hover:text-ink {item.active
					? 'text-ink'
					: 'text-ink-2'}"
				data-on={item.active === true}
				aria-current={item.active ? 'page' : undefined}
				onclick={item.onclick}>{item.label}</a
			>
		{:else}
			<button
				type="button"
				class="relative flex h-control shrink-0 items-center px-3 font-medium whitespace-nowrap transition-colors motion hover:text-ink {item.active
					? 'text-ink'
					: 'text-ink-2'}"
				data-on={item.active === true}
				aria-pressed={item.active === true}
				onclick={item.onclick}>{item.label}</button
			>
		{/if}
	{/each}
	{#if after}{@render after()}{/if}
</div>
