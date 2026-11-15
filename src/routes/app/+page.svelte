<script lang="ts">
	import { app } from '#lib/client/app.svelte.ts';
	import { openingView } from '#lib/client/directory.svelte.ts';
	import { formatDate, formatMonth, formatNumber, formatValue } from '#lib/client/format.ts';
	import { tableUrl } from '#lib/client/nav.ts';
	import { lastTable } from '#lib/client/place.ts';
	import { isTyping, pastedCells, shell, startTable } from '#lib/client/shell.svelte.ts';
	import { applyWithUndo, showToast } from '#lib/client/toast.svelte.ts';
	import { createBase, deleteRecords, updateRecord } from '#lib/core/actions.ts';
	import { lastEntry, tableFigure, type Figure } from '#lib/core/figure.ts';
	import type { BaseDef } from '#lib/core/model.ts';
	import Button from '#lib/ui/Button.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import IconButton from '#lib/ui/IconButton.svelte';
	import Menu from '#lib/ui/Menu.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import Spark from '#lib/ui/Spark.svelte';
	import { input } from '#lib/ui/styles.ts';
	import Tally from '#lib/ui/Tally.svelte';
	import NameSheet from '#lib/views/NameSheet.svelte';

	let name = $state('');
	let creatingBase = $state(false);
	let renaming = $state<BaseDef | null>(null);

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

	const leftView = $derived.by(() => {
		void app.version;
		const view = left === null ? undefined : openingView(left);
		return view === undefined ? undefined : app.ws.view(view)?.name;
	});

	function caption(figure: Figure): string {
		if (figure.kind === 'check') return figure.label;
		const { label, at, config } = figure;
		if (!figure.byDate) return at === '' ? label : `${label}, ${at}`;
		if (config.bucket === 'week') return `${label}, week of ${formatDate(at)}`;
		if (config.bucket === 'month') return `${label}, ${formatMonth(at)}`;
		return (config.rolling ?? 0) > 1 ? `${label}, ${config.rolling}-day rolling average` : label;
	}

	/** The headline as its field shows it: an amount, a percent, a clock. */
	function amount(figure: Figure & { kind: 'chart' }): string {
		const { agg, y } = figure.config;
		const field = agg === 'count' || !y ? undefined : app.ws.field(y);
		return field === undefined ? formatNumber(figure.value) : formatValue(field, figure.value);
	}

	function count(rows: number): string {
		return rows === 0 ? 'Empty' : `${formatNumber(rows)} ${rows === 1 ? 'row' : 'rows'}`;
	}

	function removeBase(base: BaseDef): void {
		const label = `Base "${base.name}" deleted`;
		const group = app.apply(deleteRecords(app.ws, [base.id]), label);
		showToast(label, group?.id ?? null);
	}

	function focusAtDesk(node: HTMLElement, when = true): void {
		// On touch, focus would raise the keyboard, or ring a row nobody pointed at.
		if (when && !isTyping(document.activeElement) && matchMedia('(pointer: fine)').matches) {
			node.focus();
		}
	}

	function step(event: KeyboardEvent): void {
		if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
		const rows = [...document.querySelectorAll<HTMLElement>('[data-home-row]')];
		const next =
			rows[rows.indexOf(event.currentTarget as HTMLElement) + (event.key === 'ArrowDown' ? 1 : -1)];
		if (next !== undefined) {
			event.preventDefault();
			next.focus();
		}
	}

	function pasteCells(event: ClipboardEvent): void {
		const text = pastedCells(event);
		if (text !== null) {
			event.preventDefault();
			shell.importing = { text, into: null };
		}
	}
</script>

<div class="flex min-h-full flex-col pb-4">
	{#if empty}
		<Empty text="No tables yet. Name one, drop a CSV here, or paste cells.">
			<form
				class="flex gap-2"
				onsubmit={(event) => {
					event.preventDefault();
					startTable(undefined, name);
				}}
			>
				<input
					use:focusAtDesk
					class={input}
					bind:value={name}
					placeholder="Table name"
					aria-label="Table name"
					onpaste={pasteCells}
				/>
				<Button variant="primary" type="submit">New table</Button>
			</form>
			<Button onclick={() => (shell.importing = { into: null })}>Import a file</Button>
		</Empty>
	{:else}
		<div
			class="sticky top-0 z-10 grid h-8 grid-cols-home items-center gap-x-4 border-b border-rule-strong bg-raised px-4 text-sm font-medium text-ink-3 max-sm:hidden"
			aria-hidden="true"
		>
			<span>Table</span>
			<span>Figure</span>
			<span></span>
			<span>Trend</span>
			<span class="max-lg:hidden">Last entry</span>
			<span class="text-right">Rows</span>
		</div>
		{#each bases as base (base.id)}
			{#if grouped}
				<div
					class="flex h-8 items-center gap-2 border-b border-rule bg-band pr-1 pl-4 max-sm:h-row"
				>
					<h2 class="min-w-0 flex-1 truncate text-sm font-medium text-ink-2">{base.name}</h2>
					<Menu label={base.name} align="end">
						{#snippet trigger(props)}
							<IconButton {...props} icon="more" label="More" tooltip={false} />
						{/snippet}
						<MenuItem icon="plus" onSelect={() => startTable(base.id)}>New table</MenuItem>
						<MenuItem icon="pencil" onSelect={() => (renaming = base)}>Rename</MenuItem>
						<MenuItem icon="x" onSelect={() => removeBase(base)}>Delete</MenuItem>
					</Menu>
				</div>
			{/if}
			{#each base.tables as table (table.id)}
				{@const here = table.id === left}
				{@const figure = table.figure}
				<a
					href={tableUrl(table.id)}
					use:focusAtDesk={here}
					onkeydown={step}
					onclick={(event) => {
						// A new table's row pushes the rows below down: the second click of a double-click on New table lands here.
						if (event.detail > 1) event.preventDefault();
					}}
					data-home-row
					aria-current={here ? 'true' : undefined}
					class="grid h-13 grid-cols-home items-center gap-x-4 border-b border-rule px-4 transition-colors motion focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus max-sm:h-auto max-sm:min-h-row max-sm:gap-y-0.5 max-sm:py-2.5 {here
						? 'bg-selected mark-selected'
						: 'hover:bg-tint'}"
				>
					<span class="flex min-w-0 items-baseline gap-2">
						<span class="truncate font-medium">{table.name}</span>
						{#if here && leftView !== undefined}
							<span class="truncate text-ink-3">{leftView}</span>
						{/if}
					</span>
					<span class="whitespace-nowrap max-sm:justify-self-end">
						{#if figure?.kind === 'chart'}
							<span class="text-lg font-semibold tight">{amount(figure)}</span>
						{:else if figure?.kind === 'check'}
							<span class="text-lg font-semibold tight">{figure.done}</span>
							<span class="text-ink-2">of {figure.total}</span>
						{:else}
							<span class="text-ink-3 sm:hidden">{count(table.rows)}</span>
						{/if}
					</span>
					<span class="truncate text-ink-3 max-sm:text-sm {figure === null ? 'max-sm:hidden' : ''}"
						>{figure === null ? '' : caption(figure)}</span
					>
					<span class="max-sm:justify-self-end {figure === null ? 'max-sm:hidden' : ''}">
						{#if figure?.kind === 'chart'}
							<Spark
								values={figure.trend}
								kind={figure.config.kind === 'line' ? 'line' : 'bar'}
								label="Trend"
							/>
						{:else if figure?.kind === 'check'}
							<Tally done={figure.done} total={figure.total} />
						{/if}
					</span>
					<span class="text-ink-2 max-lg:hidden"
						>{table.last === null ? '' : formatDate(table.last)}</span
					>
					<span class="text-right text-ink-3 max-sm:hidden">{count(table.rows)}</span>
				</a>
			{/each}
		{/each}
		<div class="flex flex-wrap gap-2 p-4">
			<Button onclick={() => startTable()}>New table</Button>
			<Button variant="ghost" onclick={() => (shell.importing = { into: null })}
				>Import a file</Button
			>
			<Button variant="ghost" onclick={() => (creatingBase = true)}>New base</Button>
		</div>
	{/if}
</div>

<NameSheet
	bind:open={creatingBase}
	title="New base"
	placeholder="Gym, Money, Reading"
	onsave={(name) => applyWithUndo(createBase(app.ws, name).changes, `Base "${name}" created`)}
/>
<NameSheet
	open={renaming !== null}
	onclose={() => (renaming = null)}
	title="Rename base"
	initial={renaming?.name ?? ''}
	action="Rename"
	onsave={(name) => {
		if (renaming !== null)
			applyWithUndo(updateRecord(app.ws, renaming.id, { name }), 'Base renamed');
	}}
/>
