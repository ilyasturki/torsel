<script lang="ts">
	import { app } from '#lib/client/app.svelte.ts';
	import { applyWithUndo } from '#lib/client/toast.svelte.ts';
	import { updateRow } from '#lib/core/actions.ts';
	import { imagesOf } from '#lib/core/images.ts';
	import type { FieldDef, Value } from '#lib/core/model.ts';
	import { table as tableWords } from '#lib/i18n/table.ts';
	import Dialog from '#lib/ui/Dialog.svelte';

	import ImageInput from './ImageInput.svelte';
	import ImageViewer from './ImageViewer.svelte';

	let {
		row,
		field,
		edit,
		onclose
	}: {
		row: string;
		field: FieldDef;
		/** Opens the images to add and remove; otherwise shows them whole. */
		edit: boolean;
		onclose: () => void;
	} = $props();

	let open = $state(true);
	let at = $state(0);

	const value = $derived.by(() => {
		void app.version;
		return app.ws.live(row)?.data[field.id] ?? null;
	});

	function set(next: Value | undefined): void {
		applyWithUndo(updateRow(app.ws, row, { [field.id]: next ?? null }), tableWords.rowChanged);
	}

	$effect(() => {
		if (!open) onclose();
	});
</script>

{#if edit}
	<Dialog bind:open title={field.name} readFirst>
		<ImageInput {field} bind:value={() => value, set} />
	</Dialog>
{:else}
	<ImageViewer bind:open bind:at base={field.base} images={imagesOf(value)} label={field.name} />
{/if}
