<script lang="ts">
	import { app } from '#lib/client/app.svelte.ts';
	import { formatDate, formatMonth, formatNumber, formatValue } from '#lib/client/format.ts';
	import { tableUrl } from '#lib/client/nav.ts';
	import { lastTable } from '#lib/client/place.ts';
	import { isTyping, shell } from '#lib/client/shell.svelte.ts';
	import { lastEntry, tableFigure, type Figure } from '#lib/core/figure.ts';
	import { home as words } from '#lib/i18n/home.ts';
	import { views as viewWords } from '#lib/i18n/views.ts';
	import Button from '#lib/ui/Button.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import Spark from '#lib/ui/Spark.svelte';
	import Tally from '#lib/ui/Tally.svelte';

	const left = lastTable();

	const bases = $derived.by(() => {
		void app.version;
		return app.ws.bases().map((base) => ({
			...base,
			tables: app.ws.tables(base.id).map((table) => ({
				...table,
				rows: app.ws.rows(table.id).length,
				figure: tableFigure(app.ws, table.id, (config) => app.chart(table.id, config)),
				last: lastEntry(app.ws, table.id)
			}))
		}));
	});

	const empty = $derived(bases.every((base) => base.tables.length === 0));
	const grouped = $derived(bases.length > 1);

	function caption(figure: Figure): string {
		if (figure.kind === 'check') return figure.label;
		const { at, config } = figure;
		const label = viewWords.chartValue[config.agg ?? 'count'](figure.of);
		if (config.agg === 'count' && config.bucket === 'month') return formatMonth(at);
		if (!figure.byDate) return at === '' ? label : `${label}, ${at}`;
		if (config.bucket === 'week') return words.weekOf(label, formatDate(at));
		if (config.bucket === 'month') return `${label}, ${formatMonth(at)}`;
		return (config.rolling ?? 0) > 1 ? words.rolling(label, config.rolling ?? 0) : label;
	}

	/** The headline as its field shows it: an amount, a percent, a clock. */
	function amount(figure: Figure & { kind: 'chart' }): string {
		const { agg, y } = figure.config;
		if (agg === 'count') return words.rows(figure.value, formatNumber(figure.value));
		const field = !y ? undefined : app.ws.field(y);
		return field === undefined ? formatNumber(figure.value) : formatValue(field, figure.value);
	}

	function focusAtDesk(node: HTMLElement, when = true): void {
		// On touch, focus would raise the keyboard, or ring a card nobody pointed at.
		if (when && !isTyping(document.activeElement) && matchMedia('(pointer: fine)').matches) {
			node.focus();
		}
	}

	const STEPS: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

	function step(event: KeyboardEvent): void {
		const by = STEPS[event.key];
		if (by === undefined) return;
		const cards = [...document.querySelectorAll<HTMLElement>('[data-home-row]')];
		const next = cards[cards.indexOf(event.currentTarget as HTMLElement) + by];
		if (next !== undefined) {
			event.preventDefault();
			next.focus();
		}
	}
</script>

<div class="flex min-h-full flex-col">
	{#if empty}
		<Empty text={words.noTables}>
			<Button variant="primary" onclick={() => (shell.importing = { into: null })}
				>{words.importFile}</Button
			>
		</Empty>
	{:else}
		<div class="grid grid-cols-cards gap-3 p-4">
			{#each bases as base (base.id)}
				{#each base.tables as table (table.id)}
					{@const here = table.id === left}
					{@const figure = table.figure}
					<a
						href={tableUrl(table.id)}
						use:focusAtDesk={here}
						onkeydown={step}
						onclick={(event) => {
							// A new table's card pushes the others along: the second click of a double-click on New table lands here.
							if (event.detail > 1) event.preventDefault();
						}}
						data-home-row
						aria-current={here ? 'true' : undefined}
						class="flex min-w-0 flex-col gap-3 rounded-box border p-4 transition-colors motion focus-visible:outline-2 focus-visible:outline-focus {here
							? 'border-rule bg-selected mark-selected'
							: 'border-rule hover:bg-tint'}"
					>
						<span class="flex items-baseline justify-between gap-3">
							<span class="flex min-w-0 items-baseline gap-2">
								<span class="truncate font-medium">{table.name}</span>
								{#if grouped}<span class="truncate text-sm text-ink-3">{base.name}</span>{/if}
							</span>
							<span class="shrink-0 text-sm text-ink-3"
								>{table.last === null ? '' : formatDate(table.last)}</span
							>
						</span>
						<span class="flex min-w-0 flex-col gap-0.5">
							<span class="text-xl font-semibold tight whitespace-nowrap">
								{#if figure?.kind === 'chart'}
									{amount(figure)}
								{:else if figure?.kind === 'check'}
									{figure.done}
									<span class="text-base font-normal text-ink-2">{words.ofTotal(figure.total)}</span
									>
								{:else if table.rows === 0}
									<span class="text-base font-normal text-ink-3">{words.empty}</span>
								{:else}
									{formatNumber(table.rows)}
								{/if}
							</span>
							<span class="truncate text-sm text-ink-3">
								{#if figure !== null}
									{caption(figure)}
								{:else if table.rows > 0}
									{words.rowsHeading}
								{/if}
							</span>
						</span>
						{#if figure?.kind === 'chart'}
							<span class="mt-auto flex h-10 items-end">
								<Spark
									values={figure.trend}
									kind={figure.config.kind === 'line' ? 'line' : 'bar'}
									label={words.trend}
									width={256}
									height={40}
								/>
							</span>
						{:else if figure?.kind === 'check'}
							<span class="mt-auto flex h-10 items-end">
								<Tally done={figure.done} total={figure.total} />
							</span>
						{/if}
					</a>
				{/each}
			{/each}
		</div>
	{/if}
</div>
