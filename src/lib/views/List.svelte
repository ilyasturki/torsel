<script lang="ts">
	import { app } from '#lib/client/app.svelte.ts';
	import { fresh } from '#lib/client/assistant.svelte.ts';
	import { formatDate, formatMonth } from '#lib/client/format.ts';
	import { shell } from '#lib/client/shell.svelte.ts';
	import { applyWithUndo } from '#lib/client/toast.svelte.ts';
	import { listLayout, updateRow } from '#lib/core/actions.ts';
	import type { FieldDef, Rec, Value, ViewDef } from '#lib/core/model.ts';
	import { isDated, isNumeric } from '#lib/core/model.ts';
	import { ratingScale } from '#lib/core/values.ts';
	import { createdAt } from '#lib/core/workspace.ts';
	import { table as tableWords } from '#lib/i18n/table.ts';
	import { views as words } from '#lib/i18n/views.ts';
	import Button from '#lib/ui/Button.svelte';
	import Chip from '#lib/ui/Chip.svelte';
	import { swatch } from '#lib/ui/colors.ts';
	import Empty from '#lib/ui/Empty.svelte';
	import { wide } from '#lib/ui/media.svelte.ts';
	import Menu from '#lib/ui/Menu.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import Rating from '#lib/ui/Rating.svelte';
	import { checkbox, focus } from '#lib/ui/styles.ts';

	import CellValue from './CellValue.svelte';
	import RowSheet from './RowSheet.svelte';

	let { tableId, view }: { tableId: string; view: ViewDef } = $props();

	const PAGE = 120;
	const BARE = new Set(['choice', 'check', 'rating']);

	let limit = $state(PAGE);
	let rowOpen = $state(false);
	let rowId = $state<string | null>(null);

	const fields = $derived.by(() => {
		void app.version;
		return app.ws.fields(tableId);
	});

	const locked = $derived.by(() => {
		void app.version;
		return new Set(
			fields.filter((field) => !app.canEditValues(tableId, field.id)).map((field) => field.id)
		);
	});
	const adds = $derived.by(() => {
		void app.version;
		return app.canAddRows(tableId);
	});

	const { group, title, show } = $derived(listLayout(fields, view.config));
	const checks = $derived(show.filter((field) => field.type === 'check'));
	const meta = $derived(show.filter((field) => field.type !== 'check'));

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
		return isDated(group.type) ? String(value).slice(0, 10) : String(value);
	}

	function groupLabel(key: string): string {
		if (key === '') return group === undefined ? '' : words.noValue;
		if (isDated(group?.type ?? 'text'))
			return key.length === 7 ? formatMonth(key) : formatDate(key);
		if (group?.type === 'link') return app.ws.rowTitle(key);
		return key;
	}

	const groups = $derived.by(() => {
		void app.version;
		const rows = [...app.ws.rows(tableId)].sort((a, b) => {
			if (isDated(group?.type ?? 'text')) {
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

	const order = $derived(groups.entries.flatMap(([, rows]) => rows.map((row) => row.id)));

	const colorOf = (field: FieldDef, name: string): string | null =>
		field.choices.find((choice) => choice.name === name)?.color ?? null;

	const blank = (value: Value | undefined): boolean =>
		value === null || value === undefined || value === '';

	function change(row: Rec, field: FieldDef, value: Value): void {
		applyWithUndo(updateRow(app.ws, row.id, { [field.id]: value }), tableWords.rowChanged);
	}

	function open(row: Rec): void {
		rowId = row.id;
		rowOpen = true;
	}

	const columns = $derived(
		[
			...checks.map(() => 'auto'),
			'minmax(0, 1fr)',
			...meta.map((field) =>
				field.type === 'rating' ? 'max-content' : 'minmax(4rem, max-content)'
			)
		].join(' ')
	);
	const lead = $derived(checks.length + 1);
</script>

{#snippet value(row: Rec, field: FieldDef)}
	{@const current = valueOf(row, field)}
	{#if locked.has(field.id) && field.type !== 'check'}
		{#if !blank(current)}
			<span class="inline-flex min-w-0 items-center gap-1.5">
				{#if !wide.current && !BARE.has(field.type)}<span class="text-ink-3">{field.name}</span
					>{/if}
				<span class="min-w-0 text-ink"><CellValue {field} value={current} /></span>
			</span>
		{/if}
	{:else if field.type === 'choice'}
		<Menu label={field.name}>
			{#snippet trigger(props)}
				<button
					{...props}
					type="button"
					class="inline-flex h-control max-w-full min-w-0 items-center rounded-box {focus} {blank(
						current
					)
						? 'px-1 text-sm text-ink-3 hover:text-ink'
						: ''}"
					aria-label="{field.name}: {blank(current) ? 'none' : current}"
				>
					{#if blank(current)}
						{wide.current ? '' : field.name}
					{:else}
						<Chip name={String(current)} color={colorOf(field, String(current))} />
					{/if}
				</button>
			{/snippet}
			{#each field.choices as choice (choice.name)}
				<MenuItem
					checked={current === choice.name}
					onSelect={() => change(row, field, choice.name)}
				>
					<span class="flex items-center gap-2">
						<span class="size-mark shrink-0 rounded-box" style={swatch(choice.color)}
						></span>{choice.name}
					</span>
				</MenuItem>
			{/each}
			{#if !blank(current)}
				<MenuItem onSelect={() => change(row, field, null)}>{words.none}</MenuItem>
			{/if}
		</Menu>
	{:else if field.type === 'rating'}
		<Rating
			{...ratingScale(field)}
			size="sm"
			label={field.name}
			value={typeof current === 'number' ? current : null}
			onchange={(next) => change(row, field, next)}
		/>
	{:else if !blank(current)}
		<span class="inline-flex min-w-0 items-center gap-1.5">
			{#if !wide.current && !BARE.has(field.type)}<span class="text-ink-3">{field.name}</span>{/if}
			<span class="min-w-0 text-ink"><CellValue {field} value={current} /></span>
		</span>
	{/if}
{/snippet}

{#snippet row_(row: Rec)}
	{#each checks as field (field.id)}
		<input
			type="checkbox"
			class={checkbox}
			aria-label={field.name}
			checked={valueOf(row, field) === true}
			disabled={locked.has(field.id)}
			onchange={() => change(row, field, valueOf(row, field) !== true)}
		/>
	{/each}
	<button
		type="button"
		class="min-w-0 truncate rounded-box py-1 text-left font-medium {focus} {wide.current
			? ''
			: 'flex-1 basis-48'}"
		onclick={() => open(row)}
	>
		{#if title !== undefined && !blank(valueOf(row, title))}
			<CellValue field={title} value={valueOf(row, title)} />
		{:else}
			<span class="font-normal text-ink-3">{words.untitled}</span>
		{/if}
	</button>
	{#if wide.current}
		{#each meta as field (field.id)}
			<span class="flex min-w-0 items-center {isNumeric(field.type) ? 'justify-end' : ''}">
				{@render value(row, field)}
			</span>
		{/each}
	{:else if meta.length > 0}
		<span class="flex flex-wrap items-center gap-x-4 gap-y-1 text-ink-2">
			{#each meta as field (field.id)}
				{@render value(row, field)}
			{/each}
		</span>
	{/if}
{/snippet}

<div
	class="pb-4 {wide.current ? 'grid gap-x-6' : 'flex min-h-full flex-col'}"
	style={wide.current ? `grid-template-columns: ${columns}` : undefined}
>
	{#each groups.entries as [key, rows], at (key)}
		{#if group !== undefined || (at === 0 && wide.current && meta.length > 0)}
			<svelte:element
				this={group === undefined ? 'div' : 'h2'}
				class="sticky top-0 z-10 flex h-row items-center gap-2 border-b border-rule bg-band px-4 text-sm font-medium text-ink-2 {wide.current
					? 'col-span-full grid grid-cols-subgrid'
					: ''}"
			>
				<span class="flex min-w-0 items-center gap-2" style="grid-column: span {lead}">
					{#if group === undefined}
						<span></span>
					{:else if group.type === 'choice' && key !== ''}
						<Chip name={key} color={colorOf(group, key)} />
					{:else}
						{groupLabel(key)}
					{/if}
					{#if group !== undefined}<span class="text-ink-3 tabular-nums">{rows.length}</span>{/if}
				</span>
				{#if wide.current}
					{#each meta as field (field.id)}
						<span class="truncate text-ink-3 {isNumeric(field.type) ? 'text-right' : ''}"
							>{field.name}</span
						>
					{/each}
				{/if}
			</svelte:element>
		{/if}
		{#each rows as row (row.id)}
			<div
				class="min-h-row items-center border-b border-rule px-4 py-1.5 transition-colors motion-slow {wide.current
					? 'col-span-full grid grid-cols-subgrid'
					: 'flex flex-wrap gap-x-4 gap-y-1'} {fresh.has(row.id) ? 'bg-tint-2' : 'hover:bg-tint'}"
				data-fresh={fresh.has(row.id) || undefined}
			>
				{@render row_(row)}
			</div>
		{/each}
	{:else}
		<div class="col-span-full">
			<Empty text={words.noRows}>
				{#if adds}
					<Button variant="primary" onclick={() => (shell.newRow = true)}>{words.addARow}</Button>
				{/if}
			</Empty>
		</div>
	{/each}

	{#if groups.total > limit}
		<div class="col-span-full p-2">
			<Button variant="ghost" onclick={() => (limit += PAGE)}>{words.showMore}</Button>
		</div>
	{/if}
</div>

<RowSheet bind:open={rowOpen} {tableId} {rowId} {order} />
