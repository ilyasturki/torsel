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

	$effect(() => {
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
			const group = app.apply(changes, 'Ligne ajoutée');
			showToast('Ligne ajoutée', group?.id ?? null);
		} else {
			const changed: Record<string, Value> = {};
			for (const field of fields) {
				if (JSON.stringify(values[field.id]) !== JSON.stringify(original[field.id])) {
					changed[field.id] = values[field.id];
				}
			}
			if (Object.keys(changed).length > 0) {
				app.apply(updateRow(app.ws, rowId, changed), 'Ligne modifiée');
			}
		}
		open = false;
	}

	function remove(): void {
		if (rowId === null) {
			return;
		}
		const group = app.apply(deleteRecords(app.ws, [rowId]), 'Ligne supprimée');
		showToast('Ligne supprimée', group?.id ?? null);
		open = false;
	}
</script>

<Sheet bind:open title={rowId === null ? 'Nouvelle ligne' : 'Ligne'}>
	<form
		class="flex flex-col gap-4"
		onsubmit={(event) => {
			event.preventDefault();
			save();
		}}
	>
		{#each fields as field (field.id)}
			<div class="flex flex-col gap-1.5">
				<label for="row-{field.id}" class="text-[13px] font-medium text-ink-muted"
					>{field.name}</label
				>
				<FieldInput
					id="row-{field.id}"
					{field}
					bind:value={values[field.id]}
					computed={computed?.[field.id] ?? null}
				/>
				{#if field.type === 'formula' && field.description}
					<span class="text-xs text-ink-faint">{field.description}</span>
				{/if}
			</div>
		{/each}
		<button type="submit" class="hidden">Enregistrer</button>
	</form>

	{#snippet footer()}
		{#if rowId !== null}
			<Button variant="ghost" onclick={remove}>Supprimer</Button>
		{/if}
		<div class="flex-1"></div>
		<Button variant="primary" onclick={save}>Enregistrer</Button>
	{/snippet}
</Sheet>
