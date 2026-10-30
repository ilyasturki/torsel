<script lang="ts">
	import { app } from '#lib/client/app.svelte.ts';
	import { showToast } from '#lib/client/toast.svelte.ts';
	import { deleteRecords, insertRows, updateRow } from '#lib/core/actions.ts';
	import type { Value } from '#lib/core/model.ts';
	import Button from '#lib/ui/Button.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';

	import FieldInput from './FieldInput.svelte';

	let {
		open = $bindable(false),
		tableId,
		rowId = null
	}: { open?: boolean; tableId: string; rowId?: string | null } = $props();

	let values = $state<Record<string, Value>>({});
	let original = $state<Record<string, Value>>({});

	const fields = $derived.by(() => {
		void app.version;
		return app.ws.fields(tableId);
	});

	const computed = $derived.by(() => {
		void app.version;
		return rowId === null ? undefined : app.computed(tableId).get(rowId);
	});

	const changed = $derived.by(() => {
		const out: Record<string, Value> = {};
		for (const field of fields) {
			if (JSON.stringify(values[field.id] ?? null) !== JSON.stringify(original[field.id] ?? null)) {
				out[field.id] = values[field.id];
			}
		}
		return out;
	});

	const dirty = $derived(Object.keys(changed).length > 0);

	$effect.pre(() => {
		if (open) {
			const row = rowId === null ? undefined : app.ws.live(rowId);
			const start: Record<string, Value> = {};
			for (const field of app.ws.fields(tableId)) {
				start[field.id] = row?.data[field.id] ?? null;
			}
			values = { ...start };
			original = start;
		}
	});

	function save(): void {
		if (rowId === null) {
			const { changes } = insertRows(app.ws, tableId, [values]);
			const group = app.apply(changes, 'Row added');
			showToast('Row added', group?.id ?? null);
		} else if (dirty) {
			app.apply(updateRow(app.ws, rowId, changed), 'Row changed');
		}
		open = false;
	}

	function remove(): void {
		if (rowId === null) {
			return;
		}
		const group = app.apply(deleteRecords(app.ws, [rowId]), 'Row deleted');
		showToast('Row deleted', group?.id ?? null);
		open = false;
	}
</script>

<Sheet bind:open title={rowId === null ? 'New row' : 'Row'} {dirty}>
	<form
		class="flex flex-col gap-3"
		onsubmit={(event) => {
			event.preventDefault();
			save();
		}}
	>
		{#each fields as field (field.id)}
			<div class="flex flex-col gap-1">
				<label for="row-{field.id}" class="text-sm font-medium text-ink-2">{field.name}</label>
				<FieldInput
					id="row-{field.id}"
					{field}
					bind:value={values[field.id]}
					computed={computed?.[field.id] ?? null}
				/>
				{#if field.type === 'formula' && field.description}
					<span class="text-sm text-ink-3">{field.description}</span>
				{/if}
			</div>
		{/each}
		<button type="submit" class="hidden">Save</button>
	</form>

	{#snippet footer()}
		{#if rowId !== null}
			<Button variant="ghost" onclick={remove}>Delete</Button>
		{/if}
		<div class="flex-1"></div>
		<Button variant="primary" onclick={save}>Save</Button>
	{/snippet}
</Sheet>
