<script lang="ts">
	import { focus } from './styles.ts';

	let {
		value = null,
		min = 1,
		max = 5,
		step = 1,
		onchange,
		label,
		id,
		size = 'md'
	}: {
		value?: number | null;
		min?: number;
		max?: number;
		step?: number;
		/** Without it the stars only show the value. */
		onchange?: (value: number | null) => void;
		label?: string;
		id?: string;
		size?: 'sm' | 'md';
	} = $props();

	const STAR = 'M8 1.5l1.95 4.1 4.5.6-3.3 3.1.85 4.45L8 11.55l-4 2.2.85-4.45-3.3-3.1 4.5-.6z';

	let hover = $state<number | null>(null);
	let row: HTMLElement | undefined = $state();

	const stars = $derived(Array.from({ length: max }, (_, at) => at + 1));
	const shown = $derived(hover ?? value ?? 0);
	const text = $derived(value === null ? 'None' : `${value} out of ${max}`);

	function fill(star: number): number {
		return Math.min(1, Math.max(0, shown - (star - 1)));
	}

	/** The value under the pointer: a star, or its left half where halves count. */
	function under(event: MouseEvent): number | null {
		if (row === undefined) return null;
		const box = row.getBoundingClientRect();
		const at = ((event.clientX - box.left) / box.width) * max;
		if (at < 0 || at > max) return null;
		const picked = step === 0.5 ? Math.ceil(at * 2) / 2 : Math.ceil(at);
		return Math.min(max, Math.max(min === 0 ? step : min, picked));
	}

	function set(next: number | null): void {
		if (next === null || (next >= min && next <= max)) onchange?.(next);
	}

	function onkeydown(event: KeyboardEvent): void {
		const keys: Record<string, () => number | null> = {
			ArrowRight: () => Math.min(max, value === null ? min : value + step),
			ArrowUp: () => Math.min(max, value === null ? min : value + step),
			ArrowLeft: () => (value === null || value - step < min ? null : value - step),
			ArrowDown: () => (value === null || value - step < min ? null : value - step),
			Home: () => min,
			End: () => max,
			Delete: () => null,
			Backspace: () => null
		};
		const digit = /^\d$/u.test(event.key) ? Number(event.key) : null;
		const next = keys[event.key];
		if (next !== undefined) {
			event.preventDefault();
			set(next());
		} else if (digit !== null) {
			event.preventDefault();
			set(digit === 0 && max === 10 ? 10 : digit);
		}
	}
</script>

{#snippet star(index: number)}
	{@const box = size === 'sm' ? 'size-3.5' : 'size-6'}
	<span class="relative shrink-0 {box}" aria-hidden="true">
		<svg viewBox="0 0 16 16" class={box}><path d={STAR} style="fill: var(--edge)" /></svg>
		{#if fill(index) > 0}
			<span class="absolute inset-y-0 left-0 overflow-hidden" style="width: {fill(index) * 100}%">
				<svg viewBox="0 0 16 16" class={box}><path d={STAR} style="fill: var(--d-amber)" /></svg>
			</span>
		{/if}
	</span>
{/snippet}

{#if onchange === undefined}
	<span class="inline-flex shrink-0 items-center gap-px" role="img" aria-label={text} data-stars>
		{#each stars as index (index)}{@render star(index)}{/each}
	</span>
{:else}
	<div
		bind:this={row}
		{id}
		role="slider"
		tabindex="0"
		aria-label={label}
		aria-valuemin={min}
		aria-valuemax={max}
		aria-valuenow={value ?? undefined}
		aria-valuetext={text}
		class="inline-flex w-fit cursor-pointer items-center gap-1 rounded-box py-1 {focus}"
		{onkeydown}
		onpointermove={(event) => {
			if (event.pointerType === 'mouse') hover = under(event);
		}}
		onpointerleave={() => (hover = null)}
		onclick={(event) => {
			const next = under(event);
			if (next !== null) set(next === value ? null : next);
		}}
	>
		{#each stars as index (index)}{@render star(index)}{/each}
	</div>
{/if}
