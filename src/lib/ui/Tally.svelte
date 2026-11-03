<script lang="ts">
	let { done, total }: { done: number; total: number } = $props();

	const W = 120;
	const H = 24;
	const BAR = 6;
	const GAP = 2;
	// Past this many, one tick per row grows thinner than it reads: the bar turns into two parts.
	const TICKS = 24;

	const ticked = $derived(total <= TICKS);
	const tick = $derived((W - GAP * (total - 1)) / total);
	const split = $derived(total === 0 ? 0 : Math.round((done / total) * W));
</script>

<svg
	viewBox="0 0 {W} {H}"
	width={W}
	height={H}
	role="img"
	aria-label="{done} of {total}"
	class="block shrink-0"
>
	{#if ticked}
		{#each { length: total } as _, index (index)}
			<rect
				x={index * (tick + GAP)}
				y={(H - BAR) / 2}
				width={tick}
				height={BAR}
				rx="1"
				fill={index < done ? 'var(--ink)' : 'var(--tint-2)'}
			/>
		{/each}
	{:else}
		{#if done > 0}
			<rect x="0" y={(H - BAR) / 2} width={split} height={BAR} rx="1" fill="var(--ink)" />
		{/if}
		{#if done < total}
			{@const from = done > 0 ? split + GAP : 0}
			<rect x={from} y={(H - BAR) / 2} width={W - from} height={BAR} rx="1" fill="var(--tint-2)" />
		{/if}
	{/if}
</svg>
