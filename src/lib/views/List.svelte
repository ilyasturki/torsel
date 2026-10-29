<script lang="ts">
	import { app } from '#lib/client/app.svelte.ts';
	import { formatDate, formatMonth } from '#lib/client/format.ts';
	import type { FieldDef, Rec, Value, ViewDef } from '#lib/core/model.ts';
	import { createdAt } from '#lib/core/workspace.ts';
	import Button from '#lib/ui/Button.svelte';
	import Chip from '#lib/ui/Chip.svelte';

	import CellValue from './CellValue.svelte';
	import RowSheet from './RowSheet.svelte';

	let { tableId, view }: { tableId: string; view: ViewDef } = $props();

	const PAGE = 120;

	let limit = $state(PAGE);
	let rowOpen = $state(false);
	let rowId = $state<string | null>(null);

	const fields = $derived.by(() => {
		void app.version;
		return app.ws.fields(tableId);
	});

	const byId = $derived(new Map(fields.map((field) => [field.id, field])));

	const group = $derived.by((): FieldDef | undefined => {
		const id = view.config.group;
		if (id === null) return undefined;
		return id === undefined
			? (fields.find((field) => field.type === 'date') ??
					fields.find((field) => field.type === 'choice'))
			: byId.get(id);
	});

	const title = $derived.by((): FieldDef | undefined => {
		const id = view.config.title;
		return id
			? byId.get(id)
			: fields.find(
					(field) => (field.type === 'text' || field.type === 'choice') && field.id !== group?.id
				);
	});

	const show = $derived.by((): FieldDef[] => {
		const ids = view.config.show;
		if (ids !== undefined)
			return ids.map((id) => byId.get(id)).filter((field) => field !== undefined);
		return fields.filter((field) => field.id !== group?.id && field.id !== title?.id).slice(0, 4);
	});

	const computed = $derived.by(() => {
		void app.version;
		return app.computed(tableId);
	});

	function valueOf(row: Rec, field: FieldDef): Value | undefined {
		return field.type === 'formula'
			? (computed.get(row.id)?.[field.id] ?? null)
			: row.data[field.id];
	}

	function groupKey(row: Rec): string {
		if (group === undefined) return '';
		const value = row.data[group.id];
		if (value === null || value === undefined) return '';
		return group.type === 'date' ? String(value).slice(0, 10) : String(value);
	}

	function groupLabel(key: string): string {
		if (key === '') return group === undefined ? '' : 'Sans valeur';
		if (group?.type === 'date') return key.length === 7 ? formatMonth(key) : formatDate(key);
		if (group?.type === 'link') return app.ws.rowTitle(key);
		return key;
	}

	const groups = $derived.by(() => {
		void app.version;
		const rows = [...app.ws.rows(tableId)].sort((a, b) => {
			if (group?.type === 'date') {
				const order = groupKey(b).localeCompare(groupKey(a));
				if (order !== 0) return order;
			}
			return createdAt(b) - createdAt(a);
		});

		const out = new Map<string, Rec[]>();
		for (const row of rows.slice(0, limit)) {
			const key = groupKey(row);
			let list = out.get(key);
			if (list === undefined) {
				list = [];
				out.set(key, list);
			}
			list.push(row);
		}
		return { total: rows.length, entries: [...out] };
	});

	const groupColor = (key: string): string | null =>
		group?.type === 'choice'
			? (group.choices.find((choice) => choice.name === key)?.color ?? null)
			: null;
</script>

<div class="mx-auto flex w-full max-w-2xl flex-col gap-5">
	{#each groups.entries as [key, rows] (key)}
		<section class="flex flex-col gap-2">
			{#if group !== undefined}
				<h2 class="flex items-center gap-2 px-1 text-[13px] font-medium text-ink-muted">
					{#if group.type === 'choice' && key !== ''}
						<Chip name={key} color={groupColor(key)} />
					{:else}
						{groupLabel(key)}
					{/if}
					<span class="text-ink-faint">· {rows.length}</span>
				</h2>
			{/if}
			<div class="flex flex-col overflow-hidden rounded-2xl bg-surface">
				{#each rows as row (row.id)}
					<button
						type="button"
						class="flex flex-col gap-1.5 border-b border-line-soft px-4 py-3 text-left last:border-b-0 hover:bg-hover"
						onclick={() => {
							rowId = row.id;
							rowOpen = true;
						}}
					>
						{#if title !== undefined}
							<span class="text-[15px] font-semibold"
								><CellValue field={title} value={valueOf(row, title)} /></span
							>
						{/if}
						{#if show.length > 0}
							<span class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
								{#each show as field (field.id)}
									<span class="inline-flex items-center gap-1">
										<span class="text-ink-faint">{field.name}</span>
										<CellValue {field} value={valueOf(row, field)} />
									</span>
								{/each}
							</span>
						{/if}
					</button>
				{/each}
			</div>
		</section>
	{:else}
		<p class="rounded-2xl bg-surface px-4 py-10 text-center text-ink-muted">
			Aucune ligne pour l’instant.
		</p>
	{/each}

	{#if groups.total > limit}
		<Button variant="ghost" onclick={() => (limit += PAGE)}>Afficher plus</Button>
	{/if}
</div>

<RowSheet bind:open={rowOpen} {tableId} {rowId} />
