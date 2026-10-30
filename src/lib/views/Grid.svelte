<script lang="ts">
	import { app } from '#lib/client/app.svelte.ts';
	import { formatNumber } from '#lib/client/format.ts';
	import { updateRecord, updateRow } from '#lib/core/actions.ts';
	import type { FieldDef, Rec, Value, ViewDef } from '#lib/core/model.ts';
	import { parseNumber } from '#lib/core/values.ts';
	import { createdAt } from '#lib/core/workspace.ts';
	import Button from '#lib/ui/Button.svelte';
	import Icon from '#lib/ui/Icon.svelte';

	import CellValue from './CellValue.svelte';
	import FieldSheet from './FieldSheet.svelte';
	import RowSheet from './RowSheet.svelte';

	let { tableId, view }: { tableId: string; view: ViewDef } = $props();

	const PAGE = 200;

	let limit = $state(PAGE);
	let editing = $state<{ row: string; field: string } | null>(null);
	let draft = $state('');
	let rowOpen = $state(false);
	let rowId = $state<string | null>(null);
	let fieldOpen = $state(false);
	let fieldId = $state<string | null>(null);

	const fields = $derived.by(() => {
		void app.version;
		const hidden = new Set(view.config.hidden ?? []);
		return app.ws.fields(tableId).filter((field) => !hidden.has(field.id));
	});

	const computed = $derived.by(() => {
		void app.version;
		return app.computed(tableId);
	});

	function blank(value: Value | undefined): boolean {
		return value === null || value === undefined || value === '';
	}

	function compare(a: Value | undefined, b: Value | undefined): number {
		if (typeof a === 'number' && typeof b === 'number') return a - b;
		return String(a).localeCompare(String(b), undefined, { numeric: true });
	}

	function valueOf(row: Rec, field: FieldDef): Value | undefined {
		return field.type === 'formula'
			? (computed.get(row.id)?.[field.id] ?? null)
			: row.data[field.id];
	}

	const rows = $derived.by(() => {
		void app.version;
		const all = app.ws.rows(tableId);
		const sort = view.config.sort;
		const field = sort ? app.ws.field(sort.field) : undefined;
		if (!sort || !field) {
			return [...all].reverse();
		}
		const dir = sort.dir === 'asc' ? 1 : -1;
		return [...all].sort((a, b) => {
			const va = valueOf(a, field);
			const vb = valueOf(b, field);
			if (blank(va) !== blank(vb)) return blank(va) ? 1 : -1;
			return (blank(va) ? 0 : compare(va, vb) * dir) || createdAt(b) - createdAt(a);
		});
	});

	const shown = $derived(rows.slice(0, limit));

	function width(field: FieldDef): string {
		switch (field.type) {
			case 'number':
			case 'formula':
				return 'w-28';
			case 'check':
				return 'w-16';
			case 'date':
				return 'w-36';
			default:
				return 'w-48';
		}
	}

	function begin(row: Rec, field: FieldDef): void {
		if (field.type === 'formula') {
			return;
		}
		if (field.type === 'check') {
			app.apply(
				updateRow(app.ws, row.id, { [field.id]: row.data[field.id] !== true }),
				`${field.name} changed`
			);
			return;
		}
		const value = row.data[field.id];
		draft =
			field.type === 'number' && typeof value === 'number'
				? formatNumber(value)
				: typeof value === 'string'
					? value.slice(0, field.type === 'date' ? 10 : undefined)
					: '';
		editing = { row: row.id, field: field.id };
	}

	function commit(field: FieldDef, value: unknown = draft): void {
		const target = editing;
		editing = null;
		if (target === null) return;
		const row = app.ws.live(target.row);
		if (row === undefined) return;
		const next =
			field.type === 'number' && typeof value === 'string'
				? parseNumber(value)
				: value === ''
					? null
					: value;
		if (JSON.stringify(next ?? null) !== JSON.stringify(row.data[field.id] ?? null)) {
			app.apply(updateRow(app.ws, row.id, { [field.id]: next }), `${field.name} changed`);
		}
	}

	function sortBy(field: FieldDef, dir: 'asc' | 'desc'): void {
		app.apply(
			updateRecord(app.ws, view.id, { config: { ...view.config, sort: { field: field.id, dir } } }),
			'Sort changed'
		);
	}

	function focus(node: HTMLElement): void {
		node.focus();
		if (node instanceof HTMLInputElement && node.type === 'text') node.select();
	}

	const linkTargets = (field: FieldDef): { id: string; title: string }[] =>
		field.target === null
			? []
			: app.ws
					.rows(field.target)
					.map((row) => ({ id: row.id, title: app.ws.rowTitle(row.id) || row.id }));
</script>

<div class="min-h-full pb-tabs-clear">
	<table class="w-full table-fixed border-separate border-spacing-0">
		<thead>
			<tr>
				<th class="sticky top-0 left-0 z-20 w-11 border-b border-hair bg-raised max-sm:bg-canvas"
				></th>
				{#each fields as field (field.id)}
					<th
						class="sticky top-0 z-10 h-row border-b border-hair bg-raised text-sm font-medium text-ink-3 max-sm:bg-canvas {width(
							field
						)}"
					>
						<button
							type="button"
							class="flex h-row w-full items-center gap-1 px-3 whitespace-nowrap transition-colors motion hover:text-ink {field.type ===
								'number' || field.type === 'formula'
								? 'justify-end'
								: ''}"
							onclick={() => {
								fieldId = field.id;
								fieldOpen = true;
							}}
						>
							{#if field.type === 'formula'}<span>ƒ</span>{/if}
							<span class="min-w-0 truncate">{field.name}</span>
							{#if view.config.sort?.field === field.id}
								<Icon
									name={view.config.sort.dir === 'asc' ? 'arrow-up' : 'arrow-down'}
									class="size-3"
								/>
							{/if}
						</button>
					</th>
				{/each}
				<th class="sticky top-0 z-10 w-11 border-b border-hair bg-raised max-sm:bg-canvas">
					<button
						type="button"
						class="flex h-row w-full items-center justify-center text-ink-3 transition-colors motion hover:text-ink"
						aria-label="Add a field"
						onclick={() => {
							fieldId = null;
							fieldOpen = true;
						}}
					>
						<Icon name="plus" />
					</button>
				</th>
				<th class="sticky top-0 z-10 border-b border-hair bg-raised max-sm:bg-canvas"></th>
			</tr>
		</thead>
		<tbody>
			{#each shown as row, index (row.id)}
				<tr class="transition-colors motion hover:bg-tint">
					<td class="sticky left-0 z-10 border-b border-hair bg-raised p-0 max-sm:bg-canvas">
						<button
							type="button"
							class="flex h-row w-full items-center justify-end pr-2 text-xs text-ink-3 transition-colors motion hover:text-ink"
							aria-label="Open row"
							onclick={() => {
								rowId = row.id;
								rowOpen = true;
							}}>{index + 1}</button
						>
					</td>
					{#each fields as field (field.id)}
						<td
							class="h-row border-b border-hair p-0 {field.type === 'number' ||
							field.type === 'formula'
								? 'text-right'
								: ''}"
						>
							{#if editing?.row === row.id && editing.field === field.id}
								{#if field.type === 'choice'}
									<select
										use:focus
										class="h-row w-full rounded-box bg-raised px-2 ring-2 ring-ink outline-none ring-inset"
										value={typeof row.data[field.id] === 'string' ? row.data[field.id] : ''}
										onchange={(event) => commit(field, event.currentTarget.value)}
										onblur={() => (editing = null)}
									>
										<option value=""></option>
										{#each field.choices as choice (choice.name)}
											<option value={choice.name}>{choice.name}</option>
										{/each}
									</select>
								{:else if field.type === 'link'}
									<select
										use:focus
										class="h-row w-full rounded-box bg-raised px-2 ring-2 ring-ink outline-none ring-inset"
										value={typeof row.data[field.id] === 'string' ? row.data[field.id] : ''}
										onchange={(event) => commit(field, event.currentTarget.value)}
										onblur={() => (editing = null)}
									>
										<option value=""></option>
										{#each linkTargets(field) as target (target.id)}
											<option value={target.id}>{target.title}</option>
										{/each}
									</select>
								{:else}
									<input
										use:focus
										class="h-row w-full rounded-box bg-raised px-3 ring-2 ring-ink outline-none ring-inset {field.type ===
										'number'
											? 'text-right'
											: ''}"
										type={field.type === 'date' ? 'date' : 'text'}
										inputmode={field.type === 'number' ? 'decimal' : undefined}
										bind:value={draft}
										onkeydown={(event) => {
											if (event.key === 'Enter') commit(field);
											if (event.key === 'Escape') editing = null;
										}}
										onblur={() => commit(field)}
									/>
								{/if}
							{:else}
								<button
									type="button"
									class="flex h-row w-full items-center rounded-box px-3 text-left transition-shadow motion {field.type ===
										'number' || field.type === 'formula'
										? 'justify-end'
										: ''} {field.type === 'formula'
										? 'cursor-default'
										: 'ring-edge ring-inset hover:ring-1'}"
									onclick={() => begin(row, field)}
								>
									<CellValue {field} value={valueOf(row, field)} />
								</button>
							{/if}
						</td>
					{/each}
					<td class="border-b border-hair"></td>
					<td class="border-b border-hair"></td>
				</tr>
			{/each}
		</tbody>
	</table>
	<button
		type="button"
		class="flex h-row w-full items-center gap-3 px-4 text-ink-3 transition-colors motion hover:bg-tint hover:text-ink"
		onclick={() => {
			rowId = null;
			rowOpen = true;
		}}
	>
		<Icon name="plus" /> Add row
	</button>
	{#if rows.length > limit}
		<div class="p-2">
			<Button variant="ghost" onclick={() => (limit += PAGE)}
				>Show {Math.min(PAGE, rows.length - limit)} more</Button
			>
		</div>
	{/if}
</div>

<RowSheet bind:open={rowOpen} {tableId} {rowId} />
<FieldSheet
	bind:open={fieldOpen}
	{tableId}
	{fieldId}
	onsort={(dir) => {
		const field = fieldId ? app.ws.field(fieldId) : undefined;
		if (field) sortBy(field, dir);
	}}
/>
