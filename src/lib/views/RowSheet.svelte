<script lang="ts">
	import { app } from '#lib/client/app.svelte.ts';
	import { formatValue } from '#lib/client/format.ts';
	import { applyWithUndo, showToast } from '#lib/client/toast.svelte.ts';
	import { deleteRecords, insertRows, updateRow } from '#lib/core/actions.ts';
	import { namesIn, toDisplay } from '#lib/core/formula.ts';
	import type { FieldDef, Value } from '#lib/core/model.ts';
	import { freshValue } from '#lib/core/values.ts';
	import { common } from '#lib/i18n/common.ts';
	import { shell as shellWords } from '#lib/i18n/shell.ts';
	import { table as words } from '#lib/i18n/table.ts';
	import Button from '#lib/ui/Button.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import { fieldIcon } from '#lib/ui/field-icons.ts';
	import Icon from '#lib/ui/Icon.svelte';
	import IconButton from '#lib/ui/IconButton.svelte';
	import Menu from '#lib/ui/Menu.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';

	import CellValue from './CellValue.svelte';
	import FieldInput from './FieldInput.svelte';

	let {
		open = $bindable(false),
		tableId,
		rowId = null,
		order
	}: {
		open?: boolean;
		tableId: string;
		rowId?: string | null;
		/** The rows ↑ and ↓ walk through, as the view shows them; the table's order otherwise. */
		order?: string[];
	} = $props();

	const PICKED = new Set(['check', 'choice', 'choices', 'link', 'rating']);

	let current = $state<string | null>(null);
	let values = $state<Record<string, Value>>({});
	let original = $state<Record<string, Value>>({});
	let menu = $state(false);

	const fields = $derived.by(() => {
		void app.version;
		return app.ws.fields(tableId);
	});

	// Fields whose values come from a source, and whether its rows do too.
	const locked = $derived.by(() => {
		void app.version;
		return app.lockedFields(tableId);
	});
	const fixed = $derived.by(() => {
		void app.version;
		return !app.canAddRows(tableId);
	});

	const stored = $derived.by(() => {
		void app.version;
		return current === null ? undefined : app.ws.live(current);
	});

	const computed = $derived.by(() => {
		void app.version;
		return current === null ? undefined : app.computed(tableId).get(current);
	});

	const walk = $derived.by(() => {
		void app.version;
		return order ?? app.ws.rows(tableId).map((row) => row.id);
	});
	const at = $derived(current === null ? -1 : walk.indexOf(current));

	const same = (a: Value | undefined, b: Value | undefined): boolean =>
		JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

	const dirty = $derived(
		current === null && fields.some((field) => !same(values[field.id], original[field.id]))
	);

	function load(id: string | null): void {
		current = id;
		const row = id === null ? undefined : app.ws.live(id);
		const start: Record<string, Value> = {};
		for (const field of app.ws.fields(tableId)) {
			start[field.id] = id === null ? freshValue(field) : (row?.data[field.id] ?? null);
		}
		values = { ...start };
		original = start;
	}

	let shown = false;
	$effect.pre(() => {
		if (open && !shown) load(rowId);
		if (!open && shown) keepAll();
		shown = open;
	});

	function keep(field: FieldDef): void {
		if (current === null || stored === undefined) return;
		if (same(values[field.id], stored.data[field.id])) return;
		applyWithUndo(updateRow(app.ws, current, { [field.id]: values[field.id] }), words.rowChanged);
	}

	function keepAll(): void {
		if (current === null || stored === undefined) return;
		const changed: Record<string, Value> = {};
		for (const field of fields) {
			if (!same(values[field.id], stored.data[field.id])) changed[field.id] = values[field.id];
		}
		if (Object.keys(changed).length > 0) {
			applyWithUndo(updateRow(app.ws, current, changed), words.rowChanged);
		}
	}

	function set(field: FieldDef, value: Value): void {
		values[field.id] = value;
		if (PICKED.has(field.type)) keep(field);
	}

	function leave(field: FieldDef, event: FocusEvent): void {
		const to = event.relatedTarget;
		const wrapper = event.currentTarget as HTMLElement;
		if (to instanceof Node && wrapper.contains(to)) return;
		keep(field);
	}

	function step(by: number): void {
		const next = walk[at + by];
		if (next === undefined) return;
		keepAll();
		load(next);
	}

	function submit(): void {
		if (current === null) {
			const { changes } = insertRows(app.ws, tableId, [values]);
			const group = app.apply(changes, words.rowAdded);
			showToast(words.rowAdded, group?.id ?? null);
		}
		open = false;
	}

	function remove(): void {
		if (current === null) return;
		const group = app.apply(deleteRecords(app.ws, [current]), words.rowDeleted);
		showToast(words.rowDeleted, group?.id ?? null);
		current = null;
		open = false;
	}

	const title = $derived.by(() => {
		void app.version;
		const primary = app.ws.primaryField(tableId);
		const named = primary === undefined ? '' : formatValue(primary, stored?.data[primary.id]);
		return current === null ? shellWords.newRow : named || words.row;
	});
</script>

{#snippet adding()}
	<div class="flex-1"></div>
	<Button variant="primary" onclick={submit}>{words.addRow}</Button>
{/snippet}

<Dialog
	bind:open
	{title}
	{dirty}
	wide
	readFirst={current !== null}
	onsubmit={submit}
	footer={current === null ? adding : undefined}
>
	{#snippet actions()}
		{#if current !== null}
			{#if walk.length > 1}
				<span class="text-sm text-ink-3 tabular-nums max-sm:hidden"
					>{words.position(at + 1, walk.length)}</span
				>
				<IconButton
					icon="arrow-up"
					label={words.previousRow}
					disabled={at <= 0}
					onclick={() => step(-1)}
				/>
				<IconButton
					icon="arrow-down"
					label={words.nextRow}
					disabled={at === -1 || at >= walk.length - 1}
					onclick={() => step(1)}
				/>
			{/if}
			{#if !fixed}
				<Menu bind:open={menu} label={words.row} align="end">
					{#snippet trigger(props)}
						<IconButton {...props} icon="more" label={common.more} tooltip={false} />
					{/snippet}
					<MenuItem icon="x" onSelect={remove}>{words.deleteRow}</MenuItem>
				</Menu>
			{/if}
		{/if}
	{/snippet}

	<div class="flex flex-col gap-2">
		{#each fields as field (`${current}-${field.id}`)}
			<div
				class="grid items-center gap-1 sm:grid-cols-props sm:gap-2"
				onfocusout={(event) => leave(field, event)}
			>
				<label
					for="row-{field.id}"
					class="flex min-w-0 items-center gap-2 px-2 text-ink-2 max-sm:text-sm"
				>
					<Icon name={fieldIcon(field.type)} class="size-4 shrink-0 text-ink-3" />
					<span class="truncate">{field.name}</span>
				</label>
				{#if field.type === 'formula'}
					<p id="row-{field.id}" class="flex min-h-control min-w-0 items-center gap-3 px-2">
						<span class="truncate">{formatValue(field, computed?.[field.id] ?? null)}</span>
						{#if field.expr}
							<span class="ml-auto truncate text-sm text-ink-3"
								>{toDisplay(field.expr, namesIn(app.ws, field.base))}</span
							>
						{/if}
					</p>
				{:else if locked.has(field.id)}
					<p
						id="row-{field.id}"
						class="flex min-h-control min-w-0 items-center gap-3 px-2"
						aria-readonly="true"
					>
						<span class="min-w-0 truncate"
							><CellValue {field} value={stored?.data[field.id] ?? null} /></span
						>
						<Icon name="lock" class="ml-auto size-4 shrink-0 text-ink-3" />
					</p>
				{:else}
					<div class="min-w-0 {field.type === 'check' ? 'flex h-control items-center px-2' : ''}">
						<FieldInput
							id="row-{field.id}"
							{field}
							bind:value={() => values[field.id], (next) => set(field, next ?? null)}
						/>
					</div>
				{/if}
			</div>
		{/each}
	</div>
</Dialog>
