<script lang="ts">
	import { markFresh, redoChange, undoChange } from '#lib/client/assistant.svelte.ts';
	import { app } from '#lib/client/app.svelte.ts';
	import { tableUrl } from '#lib/client/nav.ts';
	import type { RowDiff } from '#lib/core/diff.ts';
	import { diffOf } from '#lib/core/diff.ts';
	import type { ThreadAction } from '#lib/core/thread.ts';

	import CellValue from './CellValue.svelte';

	// `onshow` stands in for the table link where the table lives only in this page (the landing).
	let {
		action,
		onopen,
		onshow
	}: { action: ThreadAction; onopen?: () => void; onshow?: () => void } = $props();

	// A card stays short: past these, one click shows the rest.
	const ROWS = 5;

	const diff = $derived.by(() => {
		void app.version;
		return diffOf(app.ws, action);
	});

	const undone = $derived(action.status === 'undone');

	const sign = $derived(
		diff.gone.length > 0 || diff.tables.some((table) => table.removed.length > 0)
			? 'removed'
			: diff.made.length > 0 || diff.tables.some((table) => table.added.length > 0)
				? 'added'
				: 'changed'
	);

	const link = $derived.by(() => {
		void app.version;
		if (undone) return null;
		const view = diff.made.find((item) => item.kind === 'view');
		const tableId =
			diff.made.find((item) => item.kind === 'table')?.id ??
			diff.tables[0]?.id ??
			action.changes.find((change) => change.kind === 'field' || change.kind === 'view')?.parent;
		return tableId !== undefined && app.ws.table(tableId) !== undefined
			? tableUrl(tableId, view?.id)
			: null;
	});

	// The summary already names a new base or table, and a new table always comes with its views.
	const shown = $derived(
		diff.made.filter(
			(item) =>
				item.kind === 'field' ||
				(item.kind === 'view' && !diff.made.some((other) => other.kind === 'table'))
		)
	);

	const body = $derived(
		shown.length + diff.gone.length + diff.edits.length + diff.tables.length > 0
	);

	let open = $state(false);

	function rows(list: RowDiff[]): RowDiff[] {
		return open ? list : list.slice(0, ROWS);
	}

	const longest = $derived(
		Math.max(
			0,
			...diff.tables.flatMap((table) => [
				table.added.length,
				table.changed.length,
				table.removed.length
			]),
			...diff.gone.map((item) => item.values.length)
		)
	);

	function columns(list: RowDiff[]) {
		const seen = new Map<string, RowDiff['cells'][number]['field']>();
		for (const row of list) {
			for (const cell of row.cells) seen.set(cell.field.id, cell.field);
		}
		return [...seen.values()];
	}
</script>

{#snippet grid(list: RowDiff[], tone: 'added' | 'removed')}
	{@const fields = columns(list)}
	<div class="overflow-x-auto">
		<table class="text-sm">
			<thead>
				<tr>
					{#each fields as field (field.id)}
						<th class="py-0.5 pr-3 text-left font-medium whitespace-nowrap text-ink-3"
							>{field.name}</th
						>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each rows(list) as row (row.id)}
					<tr class={tone === 'removed' ? 'text-removed-ink line-through' : ''}>
						{#each fields as field (field.id)}
							{@const cell = row.cells.find((candidate) => candidate.field.id === field.id)}
							<td class="max-w-40 py-0.5 pr-3 whitespace-nowrap">
								<CellValue {field} value={tone === 'added' ? cell?.after : cell?.before} />
							</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/snippet}

<div
	class="flex flex-col rounded-box bg-tint transition-opacity motion {undone ? 'opacity-50' : ''}"
	data-testid="change"
	data-status={action.status}
>
	<div class="flex min-h-row items-center gap-2 px-2">
		<span
			class="flex size-4 shrink-0 items-center justify-center rounded-box text-xs font-semibold {sign ===
			'added'
				? 'bg-added text-added-ink'
				: sign === 'removed'
					? 'bg-removed text-removed-ink'
					: 'bg-tint-2 text-ink-2'}"
			aria-hidden="true">{sign === 'added' ? '+' : sign === 'removed' ? '−' : '~'}</span
		>
		<span class="min-w-0 flex-1 truncate font-medium {undone ? 'line-through' : ''}"
			>{action.summary}</span
		>
		{#if link !== null && onshow !== undefined}
			<button
				type="button"
				class="inline-flex h-control items-center px-1 text-sm text-ink-2 underline hover:text-ink"
				onclick={() => {
					markFresh(action);
					onshow();
				}}>Show</button
			>
		{:else if link !== null}
			<a
				class="inline-flex h-control items-center px-1 text-sm text-ink-2 underline hover:text-ink"
				href={link}
				onclick={() => {
					markFresh(action);
					onopen?.();
				}}>Show</a
			>
		{/if}
		{#if action.status === 'applied'}
			<button
				type="button"
				class="inline-flex h-control items-center px-1 text-sm text-ink-2 underline hover:text-ink"
				aria-label="Undo {action.summary}"
				onclick={() => undoChange(action)}>Undo</button
			>
		{:else if undone}
			<button
				type="button"
				class="inline-flex h-control items-center px-1 text-sm text-ink-2 underline hover:text-ink"
				aria-label="Redo {action.summary}"
				onclick={() => redoChange(action)}>Redo</button
			>
		{/if}
	</div>

	{#if body}
		<div class="flex min-w-0 flex-col gap-2 px-2 pb-2 pl-8">
			{#if shown.length > 0}
				<div class="flex flex-wrap gap-1">
					{#each shown as item (item.id)}
						<span class="rounded-box bg-added px-1.5 text-sm text-added-ink"
							>{item.name}{#if item.note}<span class="opacity-70">{` · ${item.note}`}</span
								>{/if}</span
						>
					{/each}
				</div>
			{/if}

			{#each diff.gone as item (item.id)}
				<div class="flex flex-col gap-1">
					<span
						class="self-start rounded-box bg-removed px-1.5 text-sm text-removed-ink line-through"
						>{item.name}{#if item.note}<span class="opacity-70">{` · ${item.note}`}</span
							>{/if}</span
					>
					{#if item.values.length > 0}
						<div class="flex flex-col gap-0.5 text-sm">
							{#each rows(item.values) as row (row.id)}
								<p class="flex flex-wrap items-baseline gap-x-1.5">
									<span class="text-ink-3">{row.title || 'Row'}</span>
									<span class="rounded-box bg-removed px-1 text-removed-ink line-through"
										><CellValue field={row.cells[0].field} value={row.cells[0].before} /></span
									>
								</p>
							{/each}
						</div>
					{/if}
				</div>
			{/each}

			{#each diff.edits as edit (edit.id)}
				<div class="flex flex-col gap-0.5 text-sm">
					{#each edit.lines as line, index (index)}
						<p class="flex flex-wrap items-baseline gap-x-1.5">
							<span class="text-ink-3">{edit.name} · {line.label}</span>
							{#if line.before}<span
									class="rounded-box bg-removed px-1 text-removed-ink line-through"
									>{line.before}</span
								>{/if}
							{#if line.before && line.after}<span class="text-ink-3">→</span>{/if}
							{#if line.after}<span class="rounded-box bg-added px-1 text-added-ink"
									>{line.after}</span
								>{/if}
						</p>
					{/each}
				</div>
			{/each}

			{#each diff.tables as table (table.id)}
				{#if table.added.length > 0}
					{@render grid(table.added, 'added')}
				{/if}
				{#if table.changed.length > 0}
					<div class="flex flex-col gap-0.5 text-sm">
						{#each rows(table.changed) as row (row.id)}
							{#each row.cells as cell (cell.field.id)}
								<p class="flex flex-wrap items-baseline gap-x-1.5">
									<span class="text-ink-3">{row.title || 'Row'} · {cell.field.name}</span>
									{#if cell.before != null && cell.before !== ''}
										<span class="rounded-box bg-removed px-1 text-removed-ink line-through"
											><CellValue field={cell.field} value={cell.before} /></span
										>
										<span class="text-ink-3">→</span>
									{/if}
									{#if cell.after != null && cell.after !== ''}
										<span class="rounded-box bg-added px-1 text-added-ink"
											><CellValue field={cell.field} value={cell.after} /></span
										>
									{:else}
										<span class="text-ink-3">empty</span>
									{/if}
								</p>
							{/each}
						{/each}
					</div>
				{/if}
				{#if table.removed.length > 0}
					{@render grid(table.removed, 'removed')}
				{/if}
			{/each}

			{#if longest > ROWS}
				<button
					type="button"
					class="self-start text-sm text-ink-2 underline hover:text-ink"
					onclick={() => (open = !open)}>{open ? 'Show less' : `Show all ${longest}`}</button
				>
			{/if}
		</div>
	{/if}
</div>
