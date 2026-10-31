<script lang="ts">
	import { app } from '#lib/client/app.svelte.ts';
	import { formatDate, formatMonth, formatNumber } from '#lib/client/format.ts';
	import { shell } from '#lib/client/shell.svelte.ts';
	import { chartAxis } from '#lib/core/actions.ts';
	import type { ViewDef } from '#lib/core/model.ts';
	import Button from '#lib/ui/Button.svelte';
	import { strongColor } from '#lib/ui/colors.ts';
	import Empty from '#lib/ui/Empty.svelte';

	let { tableId, view }: { tableId: string; view: ViewDef } = $props();

	let width = $state(720);
	const W = $derived(Math.max(280, Math.round(width)));
	const H = $derived(W < 520 ? 220 : 280);
	const PAD = { top: 16, right: 12, bottom: 28, left: 44 };

	const config = $derived.by(() => {
		void app.version;
		const x = chartAxis(app.ws.fields(tableId), view.config);
		return { ...view.config, x, kind: view.config.kind ?? 'bar', agg: view.config.agg ?? 'count' };
	});

	const data = $derived.by(() => {
		void app.version;
		return app.chart(tableId, config);
	});

	const xField = $derived(config.x ? app.ws.field(config.x) : undefined);
	const colorField = $derived(config.color ? app.ws.field(config.color) : undefined);

	const xs = $derived([...new Set((data?.points ?? []).map((point) => point.x))]);

	const series = $derived(
		(data?.series ?? []).map((name, index) => ({
			name,
			color:
				data !== null && data.series.length === 1 && colorField === undefined
					? 'var(--ink)'
					: strongColor(colorField?.choices.find((choice) => choice.name === name)?.color, index)
		}))
	);

	const stacked = $derived.by(() => {
		const totals = new Map<string, number>();
		for (const point of data?.points ?? []) {
			totals.set(point.x, (totals.get(point.x) ?? 0) + point.y);
		}
		return totals;
	});

	function nice(value: number): number {
		if (value <= 0) return 1;
		const power = 10 ** Math.floor(Math.log10(value));
		const scaled = value / power;
		return (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10) * power;
	}

	const yMax = $derived.by(() => {
		const values =
			config.kind === 'bar' ? [...stacked.values()] : (data?.points ?? []).map((point) => point.y);
		const max = Math.max(0, ...values);
		const min = config.kind === 'line' ? Math.min(...values) : 0;
		return {
			max: config.kind === 'bar' ? nice(max) : max === 0 ? 1 : max,
			min: Number.isFinite(min) ? min : 0
		};
	});

	const yMin = $derived(
		config.kind === 'line' ? Math.max(0, yMax.min - (yMax.max - yMax.min) * 0.15) : 0
	);

	function xPos(index: number): number {
		const inner = W - PAD.left - PAD.right;
		return xs.length <= 1 ? PAD.left + inner / 2 : PAD.left + (inner * index) / (xs.length - 1);
	}

	function yPos(value: number): number {
		const inner = H - PAD.top - PAD.bottom;
		return PAD.top + inner * (1 - (value - yMin) / (yMax.max - yMin || 1));
	}

	const band = $derived((W - PAD.left - PAD.right) / Math.max(1, xs.length));

	const bars = $derived.by(() => {
		const out: { x: number; y: number; h: number; color: string; label: string }[] = [];
		const offsets = new Map<string, number>();
		for (const point of data?.points ?? []) {
			const index = xs.indexOf(point.x);
			const base = offsets.get(point.x) ?? 0;
			offsets.set(point.x, base + point.y);
			const top = yPos(base + point.y);
			out.push({
				x: PAD.left + index * band + band * 0.15,
				y: top,
				h: yPos(base) - top,
				color: series.find((item) => item.name === point.series)?.color ?? 'var(--ink)',
				label: `${label(point.x)}: ${formatNumber(point.y)}`
			});
		}
		return out;
	});

	const lines = $derived(
		series.map((item) => ({
			...item,
			points: (data?.points ?? [])
				.filter((point) => point.series === item.name)
				.map((point) => `${xPos(xs.indexOf(point.x))},${yPos(point.y)}`)
				.join(' ')
		}))
	);

	function label(x: string): string {
		if (xField?.type === 'date') {
			return x.length === 7 ? formatMonth(x) : formatDate(x);
		}
		return x;
	}

	const per = $derived(
		xField?.type === 'date' && config.bucket === 'week'
			? 'per week'
			: xField?.type === 'date' && config.bucket === 'month'
				? 'per month'
				: xField?.type === 'date'
					? ''
					: `per ${(data?.xLabel ?? '').toLowerCase()}`
	);
	const ticks = $derived([yMin, (yMin + yMax.max) / 2, yMax.max]);
	const xTicks = $derived(
		xs.length <= 3
			? xs.map((_, index) => index)
			: [0, Math.floor((xs.length - 1) / 2), xs.length - 1]
	);

	const latest = $derived.by(() => {
		const last = xs.at(-1);
		if (last === undefined) return null;
		return {
			x: last,
			y:
				config.kind === 'bar'
					? (stacked.get(last) ?? 0)
					: (data?.points.filter((point) => point.x === last).at(-1)?.y ?? 0)
		};
	});
</script>

<div class="flex min-h-full flex-col gap-1 p-6 pb-tabs-clear max-sm:p-4 max-sm:pb-tabs-clear">
	{#if data === null}
		<Empty text="Pick an axis and a calculation for this chart in View settings." />
	{:else}
		<span class="font-medium text-ink-3">{data.yLabel}</span>
		{#if latest !== null}
			<p class="text-hero-lg leading-none font-semibold tighter">{formatNumber(latest.y)}</p>
		{/if}
		<p class="mb-3 text-ink-2">
			{[
				latest === null ? '' : label(latest.x),
				per,
				config.rolling ? `${config.rolling}-day rolling average` : ''
			]
				.filter((part) => part !== '')
				.join(', ')}
		</p>

		{#if xs.length === 0}
			<Empty text="No data yet. Add a row and it shows up here.">
				<Button variant="primary" onclick={() => (shell.newRow = true)}>Add a row</Button>
			</Empty>
		{:else}
			<div bind:clientWidth={width}>
				<svg
					viewBox="0 0 {W} {H}"
					width={W}
					height={H}
					class="block w-full"
					role="img"
					aria-label="{data.yLabel} per {data.xLabel}"
				>
					{#each ticks as tick (tick)}
						<line
							x1={PAD.left}
							x2={W - PAD.right}
							y1={yPos(tick)}
							y2={yPos(tick)}
							stroke="var(--hair)"
						/>
						<text
							x={PAD.left - 8}
							y={yPos(tick) + 4}
							text-anchor="end"
							font-size="11.5"
							fill="var(--ink-3)">{formatNumber(Math.round(tick * 10) / 10)}</text
						>
					{/each}

					{#if config.kind === 'bar'}
						{#each bars as bar, index (index)}
							<rect
								x={bar.x}
								y={bar.y}
								width={Math.max(1, band * 0.7)}
								height={Math.max(0, bar.h)}
								fill={bar.color}
							>
								<title>{bar.label}</title>
							</rect>
						{/each}
					{:else}
						{#each lines as line (line.name)}
							<polyline
								points={line.points}
								fill="none"
								stroke={line.color}
								stroke-width="2"
								stroke-linejoin="round"
								stroke-linecap="round"
							/>
						{/each}
					{/if}

					{#each xTicks as index (index)}
						<text
							x={config.kind === 'bar' ? PAD.left + index * band + band / 2 : xPos(index)}
							y={H - 8}
							text-anchor={index === 0 ? 'start' : index === xs.length - 1 ? 'end' : 'middle'}
							font-size="11.5"
							fill="var(--ink-3)">{label(xs[index])}</text
						>
					{/each}
				</svg>
			</div>

			{#if series.length > 1}
				<div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-2">
					{#each series as item (item.name)}
						<span class="inline-flex items-center gap-2">
							<span class="size-mark rounded-box" style="background: {item.color}"></span>
							{item.name || 'No value'}
						</span>
					{/each}
				</div>
			{/if}
		{/if}
	{/if}
</div>
