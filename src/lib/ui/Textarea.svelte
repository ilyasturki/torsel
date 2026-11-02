<script lang="ts">
	import type { HTMLTextareaAttributes } from 'svelte/elements';

	import { textarea } from './styles.ts';

	let {
		value = $bindable(''),
		ref = $bindable(null),
		rows = 1,
		maxRows = 8,
		bare = false,
		class: extra = '',
		...rest
	}: Omit<HTMLTextareaAttributes, 'value'> & {
		value?: string;
		ref?: HTMLTextAreaElement | null;
		rows?: number;
		/** The height it grows to before it scrolls. */
		maxRows?: number;
		/** No surface of its own: the wrapper draws it, focus ring included (`fieldFocusWithin`). */
		bare?: boolean;
	} = $props();

	let height = $state<number | null>(null);

	function measure(): void {
		if (ref === null) return;
		const style = getComputedStyle(ref);
		const line = parseFloat(style.lineHeight);
		const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
		const pad = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + border;
		const shown = ref.style.height;
		ref.style.height = 'auto';
		const wanted = ref.scrollHeight + border;
		ref.style.height = shown;
		height = Math.min(Math.max(wanted, line * rows + pad), line * maxRows + pad);
	}

	$effect(() => {
		void value;
		measure();
	});

	$effect(() => {
		if (ref === null) return;
		let width = 0;
		// Only a new width rewraps the text; reacting to the height it sets would loop.
		const observer = new ResizeObserver(([entry]) => {
			if (entry.contentRect.width === width) return;
			width = entry.contentRect.width;
			measure();
		});
		observer.observe(ref);
		return () => observer.disconnect();
	});
</script>

<textarea
	bind:this={ref}
	bind:value
	{rows}
	style:height={height === null ? undefined : `${height}px`}
	class="block resize-none {bare
		? 'w-full min-w-0 bg-transparent text-ink outline-none placeholder:text-ink-3'
		: `${textarea} font-sans`} {extra}"
	{...rest}></textarea>
