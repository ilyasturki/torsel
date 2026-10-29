<script lang="ts">
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import Plus from '@lucide/svelte/icons/plus';

	import { app } from '#lib/client/app.svelte.ts';
	import { formatNumber } from '#lib/client/format.ts';
	import { updateRecord, updateRow } from '#lib/core/actions.ts';
	import type { FieldDef, Rec, Value, ViewDef } from '#lib/core/model.ts';
	import { parseNumber } from '#lib/core/values.ts';
	import { createdAt } from '#lib/core/workspace.ts';
	import Button from '#lib/ui/Button.svelte';

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
		return String(a).localeCompare(String(b), 'fr', { numeric: true });
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
				return 'min-w-24';
			case 'check':
				return 'min-w-16';
			case 'date':
				return 'min-w-28';
			default:
				return 'min-w-40';
		}
	}

	function begin(row: Rec, field: FieldDef): void {
		if (field.type === 'formula') {
			return;
		}
		if (field.type === 'check') {
			app.apply(
				updateRow(app.ws, row.id, { [field.id]: row.data[field.id] !== true }),
				`${field.name} modifié`
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
			app.apply(updateRow(app.ws, row.id, { [field.id]: next }), `${field.name} modifié`);
		}
	}

	function sortBy(field: FieldDef, dir: 'asc' | 'desc'): void {
		app.apply(
			updateRecord(app.ws, view.id, { config: { ...view.config, sort: { field: field.id, dir } } }),
			'Tri modifié'
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

<div class="overflow-x-auto rounded-2xl bg-surface">
	<table class="w-full border-collapse text-[14px]">
		<thead>
			<tr class="border-b border-line text-left text-[13px] text-ink-muted">
				<th class="sticky left-0 z-10 w-10 bg-surface px-2 py-2 font-medium"></th>
				{#each fields as field (field.id)}
					<th class="px-1 py-1 font-medium {width(field)}">
						<button
							type="button"
							class="flex w-full items-center gap-1 rounded-lg px-2 py-1.5 text-left whitespace-nowrap hover:bg-hover {field.type ===
							'formula'
								? 'text-ink'
								: ''} {field.type === 'number' || field.type === 'formula' ? 'justify-end' : ''}"
							onclick={() => {
								fieldId = field.id;
								fieldOpen = true;
							}}
						>
							{#if field.type === 'formula'}<i class="font-serif">ƒ</i>{/if}
							{field.name}
							{#if view.config.sort?.field === field.id}
								{#if view.config.sort.dir === 'asc'}<ArrowUp class="size-3.5" />{:else}<ArrowDown
										class="size-3.5"
									/>{/if}
							{/if}
						</button>
					</th>
				{/each}
				<th class="w-12 px-1 py-1">
					<button
						type="button"
						class="flex size-8 items-center justify-center rounded-lg hover:bg-hover"
						aria-label="Ajouter un champ"
						onclick={() => {
							fieldId = null;
							fieldOpen = true;
						}}
					>
						<Plus class="size-4" />
					</button>
				</th>
			</tr>
		</thead>
		<tbody>
			{#each shown as row, index (row.id)}
				<tr class="border-b border-line-soft">
					<td class="sticky left-0 z-10 bg-surface px-1">
						<button
							type="button"
							class="flex h-9 w-9 items-center justify-center rounded-lg text-xs text-ink-faint hover:bg-hover"
							aria-label="Ouvrir la ligne"
							onclick={() => {
								rowId = row.id;
								rowOpen = true;
							}}>{index + 1}</button
						>
					</td>
					{#each fields as field (field.id)}
						<td
							class="h-10 px-1 {field.type === 'number' || field.type === 'formula'
								? 'text-right'
								: ''}"
						>
							{#if editing?.row === row.id && editing.field === field.id}
								{#if field.type === 'choice'}
									<select
										use:focus
										class="h-9 w-full rounded-lg border border-ink bg-surface px-2"
										value={typeof row.data[field.id] === 'string' ? row.data[field.id] : ''}
										onchange={(event) => commit(field, event.currentTarget.value)}
										onblur={() => (editing = null)}
									>
										<option value="">—</option>
										{#each field.choices as choice (choice.name)}
											<option value={choice.name}>{choice.name}</option>
										{/each}
									</select>
								{:else if field.type === 'link'}
									<select
										use:focus
										class="h-9 w-full rounded-lg border border-ink bg-surface px-2"
										value={typeof row.data[field.id] === 'string' ? row.data[field.id] : ''}
										onchange={(event) => commit(field, event.currentTarget.value)}
										onblur={() => (editing = null)}
									>
										<option value="">—</option>
										{#each linkTargets(field) as target (target.id)}
											<option value={target.id}>{target.title}</option>
										{/each}
									</select>
								{:else}
									<input
										use:focus
										class="h-9 w-full rounded-lg border border-ink bg-surface px-2 {field.type ===
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
									class="flex h-9 w-full items-center rounded-lg px-2 text-left hover:bg-hover {field.type ===
										'number' || field.type === 'formula'
										? 'justify-end font-medium'
										: ''} {field.type === 'formula' ? 'cursor-default bg-surface-2/60' : ''}"
									onclick={() => begin(row, field)}
								>
									<CellValue {field} value={valueOf(row, field)} />
								</button>
							{/if}
						</td>
					{/each}
					<td></td>
				</tr>
			{/each}
		</tbody>
	</table>
	{#if rows.length === 0}
		<p class="px-4 py-10 text-center text-ink-muted">Aucune ligne pour l’instant.</p>
	{/if}
</div>

<div class="mt-3 flex flex-wrap items-center gap-2">
	<Button
		onclick={() => {
			rowId = null;
			rowOpen = true;
		}}
	>
		<Plus class="size-4" /> Nouvelle ligne
	</Button>
	{#if rows.length > limit}
		<Button variant="ghost" onclick={() => (limit += PAGE)}
			>Afficher {Math.min(PAGE, rows.length - limit)} de plus</Button
		>
	{/if}
	<span class="ml-auto text-[13px] text-ink-muted"
		>{rows.length} ligne{rows.length > 1 ? 's' : ''}</span
	>
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
