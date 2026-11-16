<script lang="ts">
	import { untrack } from 'svelte';

	import { app } from '#lib/client/app.svelte.ts';
	import { formatDate, formatMonth, formatNumber, formatValue } from '#lib/client/format.ts';
	import { shell } from '#lib/client/shell.svelte.ts';
	import { applyWithUndo } from '#lib/client/toast.svelte.ts';
	import { chartSetup, updateRecord } from '#lib/core/actions.ts';
	import type { Aggregate } from '#lib/core/chart.ts';
	import { axisTicks, headline, totalled } from '#lib/core/chart.ts';
	import type { ChartConfig, Value, ViewDef } from '#lib/core/model.ts';
	import { isDated, isNumeric } from '#lib/core/model.ts';
	import Rich from '#lib/i18n/Rich.svelte';
	import { views as words } from '#lib/i18n/views.ts';
	import Button from '#lib/ui/Button.svelte';
	import { strongColor } from '#lib/ui/colors.ts';
	import Empty from '#lib/ui/Empty.svelte';
	import { wide } from '#lib/ui/media.svelte.ts';
	import Segmented from '#lib/ui/Segmented.svelte';
	import { focus } from '#lib/ui/styles.ts';

	import ChartToken from './ChartToken.svelte';

	let {
		tableId,
		view,
		still = false
	}: {
		tableId: string;
		view: ViewDef;
		/** Shown, not set: the landing's showcase. */ still?: boolean;
	} = $props();

	const fixed = $derived(still || app.readOnly);

	let width = $state(720);
	let active = $state<number | null>(null);
	const W = $derived(Math.max(280, Math.round(width)));
	const H = $derived(W < 520 ? 220 : 280);
	const PAD = { top: 12, right: 12, bottom: 28, left: 48 };

	const fields = $derived.by(() => {
		void app.version;
		return app.ws.fields(tableId);
	});

	const config = $derived.by(() => {
		void app.version;
		return chartSetup(fields, view.config, app.ws.rows(tableId));
	});

	let firstOpen = $state(false);

	$effect(() => {
		if (shell.freshChart !== view.id) return;
		untrack(() => {
			shell.freshChart = null;
			if (wide.current) requestAnimationFrame(() => (firstOpen = true));
		});
	});

	function setChart(patch: ChartConfig): void {
		const current = app.ws.view(view.id);
		if (current === undefined) return;
		const next = JSON.parse(JSON.stringify({ ...current.config, ...patch })) as Value;
		applyWithUndo(updateRecord(app.ws, view.id, { config: next }), words.viewChanged(current.name));
	}

	const numeric = $derived(
		fields.filter((field) => isNumeric(field.type) || field.type === 'formula')
	);
	const fieldOptions = (list: typeof fields): { value: string; label: string }[] =>
		list.map((field) => ({ value: field.id, label: field.name }));
	const aggregates = Object.keys(words.aggregates) as Aggregate[];
	const buckets = $derived([
		{ value: 'day', label: words.day },
		{ value: 'week', label: words.week },
		{ value: 'month', label: words.month }
	]);
	const bucket = $derived(buckets.find((item) => item.value === (config.bucket ?? 'day')));

	function setAgg(agg: string): void {
		const y = agg !== 'count' && !config.y ? (numeric[0]?.id ?? null) : config.y;
		setChart({ agg: agg as Aggregate, y });
	}

	const data = $derived.by(() => {
		void app.version;
		return app.chart(tableId, config);
	});

	const adds = $derived.by(() => {
		void app.version;
		return app.canAddRows(tableId);
	});

	const xField = $derived(config.x ? app.ws.field(config.x) : undefined);
	const colorField = $derived(config.color ? app.ws.field(config.color) : undefined);
	const yField = $derived(config.agg !== 'count' && config.y ? app.ws.field(config.y) : undefined);

	/** An amount as its field shows it; an axis tick stays short, so only a clock or a percent there. */
	function amount(value: number, tick = false): string {
		const short = yField?.type === 'duration' || yField?.type === 'percent';
		return yField === undefined || (tick && !short)
			? formatNumber(value)
			: formatValue(yField, value);
	}

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

	const scale = $derived.by(() => {
		const values =
			config.kind === 'bar' ? [...stacked.values()] : (data?.points ?? []).map((point) => point.y);
		const high = Math.max(0, ...values);
		const low = config.kind === 'line' ? Math.min(...values) : 0;
		return axisTicks(Number.isFinite(low) ? low : 0, high, H < 260 ? 3 : 4);
	});
	const yMin = $derived(scale[0]);
	const yMax = $derived(scale.at(-1) ?? 1);

	const inner = $derived(W - PAD.left - PAD.right);
	const band = $derived(inner / Math.max(1, xs.length));

	function xPos(index: number): number {
		if (config.kind === 'bar') return PAD.left + band * (index + 0.5);
		return xs.length <= 1 ? PAD.left + inner / 2 : PAD.left + (inner * index) / (xs.length - 1);
	}

	function yPos(value: number): number {
		const tall = H - PAD.top - PAD.bottom;
		return PAD.top + tall * (1 - (value - yMin) / (yMax - yMin || 1));
	}

	const colorOf = (name: string): string =>
		series.find((item) => item.name === name)?.color ?? 'var(--ink)';

	const bars = $derived.by(() => {
		const out: { index: number; x: number; y: number; h: number; color: string }[] = [];
		const offsets = new Map<string, number>();
		for (const point of data?.points ?? []) {
			const index = xs.indexOf(point.x);
			const base = offsets.get(point.x) ?? 0;
			offsets.set(point.x, base + point.y);
			const top = yPos(base + point.y);
			out.push({
				index,
				x: PAD.left + index * band + band * 0.15,
				y: top,
				h: yPos(base) - top,
				color: colorOf(point.series)
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
		if (isDated(xField?.type ?? 'text')) {
			return x.length === 7 ? formatMonth(x) : formatDate(x);
		}
		if (xField?.type === 'check') return x === '1' ? words.yes : words.no;
		return x === '' ? words.noValue : x;
	}

	const byDate = $derived(isDated(xField?.type ?? 'text'));

	const per = $derived(
		!fixed
			? ''
			: byDate && config.bucket === 'week'
				? words.perWeek
				: byDate && config.bucket === 'month'
					? words.perMonth
					: byDate
						? ''
						: totalled(config, byDate)
							? words.byField(data?.xName ?? '')
							: words.perField(data?.xName ?? '')
	);
	const valueName = $derived(data === null ? '' : words.chartValue[data.agg](data.yName));

	const xTicks = $derived.by(() => {
		const room = Math.max(2, Math.floor(inner / (byDate ? 96 : 72)));
		if (xs.length <= room) return xs.map((_, index) => index);
		const step = (xs.length - 1) / (room - 1);
		return [...new Set(Array.from({ length: room }, (_, at) => Math.round(at * step)))];
	});

	const latest = $derived(data === null ? null : headline(data, config, byDate));

	const readout = $derived.by(() => {
		if (active === null || xs[active] === undefined) return null;
		const x = xs[active];
		const rows = series
			.map((item) => ({
				...item,
				y: (data?.points ?? []).find((point) => point.x === x && point.series === item.name)?.y
			}))
			.filter((row) => row.y !== undefined);
		return { x, rows, sum: config.kind === 'bar' && rows.length > 1 ? stacked.get(x) : undefined };
	});

	function pointAt(event: PointerEvent): void {
		const svg = event.currentTarget as SVGElement;
		const box = svg.getBoundingClientRect();
		const x = ((event.clientX - box.left) / box.width) * W;
		if (xs.length === 0) return;
		const raw =
			config.kind === 'bar'
				? Math.floor((x - PAD.left) / band)
				: Math.round(((x - PAD.left) / Math.max(1, inner)) * (xs.length - 1));
		active = Math.min(xs.length - 1, Math.max(0, raw));
	}

	function onkeydown(event: KeyboardEvent): void {
		if (xs.length === 0) return;
		if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
			event.preventDefault();
			const by = event.key === 'ArrowRight' ? 1 : -1;
			const from = active ?? (by === 1 ? -1 : xs.length);
			active = Math.min(xs.length - 1, Math.max(0, from + by));
		} else if (event.key === 'Escape') {
			active = null;
		}
	}

	const tipLeft = $derived(
		active === null ? 0 : Math.min(Math.max(xPos(active) / W, 0.08), 0.92) * 100
	);
</script>

<div class="flex min-h-full flex-col gap-1 p-6 max-sm:p-4">
	{#if data === null}
		<Empty text={words.chartUnset} />
	{:else}
		{#if fixed}
			<span class="font-medium text-ink-3">{valueName}</span>
		{:else}
			<div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
				<p class="flex flex-wrap items-center gap-1 text-ink-3" data-testid="chart-line">
					<Rich text={words.chartLine(config.agg !== 'count', byDate, yField?.name ?? '')}>
						{#snippet agg(_: string)}
							<ChartToken
								bind:open={firstOpen}
								label={words.calculation}
								text={words.aggregates[config.agg ?? 'count']}
								options={aggregates.map((value) => ({ value, label: words.aggregates[value] }))}
								value={config.agg ?? 'count'}
								onpick={setAgg}
							/>
						{/snippet}
						{#snippet y(_: string)}
							<ChartToken
								label={words.of}
								text={yField?.name ?? ''}
								options={fieldOptions(numeric)}
								value={config.y ?? ''}
								onpick={(field) => setChart({ y: field })}
							/>
						{/snippet}
						{#snippet x(_: string)}
							<ChartToken
								label={words.xAxis}
								text={xField?.name ?? ''}
								options={fieldOptions(fields.filter((field) => field.type !== 'image'))}
								value={config.x ?? ''}
								onpick={(field) => setChart({ x: field })}
							/>
						{/snippet}
						{#snippet bucketToken(_: string)}
							<ChartToken
								label={words.groupDatesBy}
								text={bucket?.label.toLocaleLowerCase() ?? ''}
								options={buckets}
								value={config.bucket ?? 'day'}
								onpick={(value) => setChart({ bucket: value as ChartConfig['bucket'] })}
							/>
						{/snippet}
					</Rich>
				</p>
				<div class="flex items-center gap-2">
					<Segmented
						label={words.chartKind}
						items={[
							{
								id: 'bar',
								label: words.bars,
								active: config.kind === 'bar',
								onclick: () => setChart({ kind: 'bar' })
							},
							{
								id: 'line',
								label: words.line,
								active: config.kind === 'line',
								onclick: () => setChart({ kind: 'line' })
							}
						]}
					/>
					<ChartToken
						label={words.colourBy}
						text={words.chartColour(colorField?.name ?? null)}
						options={[
							{ value: '', label: words.oneSeries },
							...fieldOptions(fields.filter((field) => field.type === 'choice'))
						]}
						value={config.color ?? ''}
						onpick={(field) => setChart({ color: field || null })}
					/>
				</div>
			</div>
		{/if}
		{#if latest !== null}
			<p class="text-hero-lg leading-none font-semibold tighter">{amount(latest.y)}</p>
		{/if}
		<p class="mb-3 text-ink-2">
			{[
				latest === null ? '' : latest.x === '' ? '' : label(latest.x),
				per,
				config.rolling ? words.rolling(config.rolling) : ''
			]
				.filter((part) => part !== '')
				.join(', ')}
		</p>

		{#if xs.length === 0}
			<Empty text={words.noData}>
				{#if adds}
					<Button variant="primary" onclick={() => (shell.newRow = true)}>{words.addARow}</Button>
				{/if}
			</Empty>
		{:else}
			<div class="relative" bind:clientWidth={width}>
				<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
				<svg
					viewBox="0 0 {W} {H}"
					width={W}
					height={H}
					class="block w-full touch-pan-y rounded-box outline-none select-none {focus}"
					role="img"
					aria-label={words.chartName(valueName, data.xName)}
					tabindex="0"
					onpointermove={pointAt}
					onpointerdown={pointAt}
					onpointerleave={(event) => {
						if (event.pointerType === 'mouse') active = null;
					}}
					onblur={() => (active = null)}
					{onkeydown}
				>
					{#each scale as tick (tick)}
						<line
							x1={PAD.left}
							x2={W - PAD.right}
							y1={yPos(tick)}
							y2={yPos(tick)}
							stroke={tick === 0 ? 'var(--rule-strong)' : 'var(--rule)'}
						/>
						<text
							x={PAD.left - 8}
							y={yPos(tick) + 4}
							text-anchor="end"
							font-size="11.5"
							fill="var(--ink-3)">{amount(tick, true)}</text
						>
					{/each}

					{#if config.kind === 'bar'}
						{#if active !== null}
							<rect
								x={PAD.left + active * band}
								y={PAD.top}
								width={band}
								height={H - PAD.top - PAD.bottom}
								fill="var(--tint)"
							/>
						{/if}
						{#each bars as bar, index (index)}
							<rect
								x={bar.x}
								y={bar.y}
								width={Math.max(1, band * 0.7)}
								height={Math.max(0, bar.h - (series.length > 1 ? 1 : 0))}
								fill={bar.color}
								opacity={active === null || active === bar.index ? 1 : 0.55}
							/>
						{/each}
					{:else}
						{#if active !== null}
							<line
								x1={xPos(active)}
								x2={xPos(active)}
								y1={PAD.top}
								y2={H - PAD.bottom}
								stroke="var(--rule-strong)"
							/>
						{/if}
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
						{#if readout !== null && active !== null}
							{#each readout.rows as row (row.name)}
								<circle
									cx={xPos(active)}
									cy={yPos(row.y ?? 0)}
									r="4"
									fill={row.color}
									stroke="var(--raised)"
									stroke-width="2"
								/>
							{/each}
						{/if}
					{/if}

					{#each xTicks as index (index)}
						<text
							x={xPos(index)}
							y={H - 8}
							text-anchor={config.kind === 'bar' || xs.length === 1
								? 'middle'
								: index === 0
									? 'start'
									: index === xs.length - 1
										? 'end'
										: 'middle'}
							font-size="11.5"
							fill="var(--ink-3)">{label(xs[index])}</text
						>
					{/each}
				</svg>

				{#if readout !== null}
					<div
						class="pointer-events-none absolute top-0 z-10 flex min-w-32 -translate-x-1/2 flex-col gap-1 rounded-panel bg-float px-3 py-2 shadow-float"
						style="left: {tipLeft}%"
						data-testid="chart-readout"
					>
						<span class="text-sm text-ink-3">{label(readout.x)}</span>
						{#each readout.rows as row (row.name)}
							<span class="flex items-center gap-2 tabular-nums">
								{#if series.length > 1}
									<span class="h-0.5 w-3 shrink-0 rounded-box" style="background: {row.color}"
									></span>
								{/if}
								<span class="font-semibold">{amount(row.y ?? 0)}</span>
								{#if series.length > 1}
									<span class="truncate text-ink-2">{row.name || words.noValue}</span>
								{/if}
							</span>
						{/each}
						{#if readout.sum !== undefined}
							<span class="flex items-center gap-2 border-t border-rule pt-1 tabular-nums">
								<span class="font-semibold">{amount(readout.sum)}</span>
								<span class="text-ink-2">{words.total}</span>
							</span>
						{/if}
					</div>
				{/if}
			</div>

			{#if series.length > 1}
				<div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-2">
					{#each series as item (item.name)}
						<span class="inline-flex items-center gap-2">
							<span class="size-mark rounded-box" style="background: {item.color}"></span>
							{item.name || words.noValue}
						</span>
					{/each}
				</div>
			{/if}
		{/if}
	{/if}
</div>
