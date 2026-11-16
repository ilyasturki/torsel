<script lang="ts">
	let {
		values,
		kind = 'line',
		label,
		width: W = 120,
		height: H = 24
	}: {
		/** Oldest first; the last one is drawn in ink. */
		values: number[];
		kind?: 'line' | 'bar';
		label: string;
		width?: number;
		height?: number;
	} = $props();

	const GAP = 2;

	const low = $derived(kind === 'bar' ? Math.min(0, ...values) : Math.min(...values));
	const high = $derived(Math.max(...values));

	function y(value: number): number {
		return high === low ? H / 2 : H - 3 - ((value - low) / (high - low)) * (H - 6);
	}

	function x(index: number): number {
		return values.length === 1 ? W - 3 : 3 + (index * (W - 6)) / (values.length - 1);
	}

	const barWidth = $derived(Math.min(8, (W - GAP * (values.length - 1)) / values.length));
	const barStart = $derived(W - values.length * barWidth - (values.length - 1) * GAP);
	const path = $derived(
		values.map((value, index) => `${index === 0 ? 'M' : 'L'}${x(index)} ${y(value)}`).join('')
	);
</script>

<svg
	viewBox="0 0 {W} {H}"
	width={W}
	height={H}
	role="img"
	aria-label={label}
	class="block shrink-0 overflow-visible"
>
	{#if kind === 'bar'}
		{#each values as value, index (index)}
			{@const zero = y(0)}
			{@const height = value === 0 ? 0 : Math.max(1.5, Math.abs(y(value) - zero))}
			<rect
				x={barStart + index * (barWidth + GAP)}
				y={value < 0 ? zero : zero - height}
				width={barWidth}
				{height}
				rx="1"
				fill={index === values.length - 1 ? 'var(--ink)' : 'var(--rule-strong)'}
			/>
		{/each}
	{:else if values.length > 0}
		<path
			d={path}
			fill="none"
			stroke="var(--ink-2)"
			stroke-width="1.5"
			stroke-linejoin="round"
			stroke-linecap="round"
		/>
		<circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r="2.5" fill="var(--ink)" />
	{/if}
</svg>
