<script lang="ts">
	import { goto } from '$app/navigation';

	import { app } from '#lib/client/app.svelte.ts';
	import { SETTINGS } from '#lib/client/nav.ts';
	import { shell, startTable } from '#lib/client/shell.svelte.ts';
	import { applyWithUndo, showToast } from '#lib/client/toast.svelte.ts';
	import { createBase, deleteRecords, updateRecord } from '#lib/core/actions.ts';
	import type { BaseDef } from '#lib/core/model.ts';
	import { common } from '#lib/i18n/common.ts';
	import { home as words } from '#lib/i18n/home.ts';
	import { shell as shellWords } from '#lib/i18n/shell.ts';
	import IconButton from '#lib/ui/IconButton.svelte';
	import Menu from '#lib/ui/Menu.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import MenuSeparator from '#lib/ui/MenuSeparator.svelte';
	import MenuSub from '#lib/ui/MenuSub.svelte';
	import { wide } from '#lib/ui/media.svelte.ts';

	import NameSheet from './NameSheet.svelte';

	let creating = $state(false);
	let renaming = $state<BaseDef | null>(null);

	const bases = $derived.by(() => {
		void app.version;
		return app.ws.bases();
	});

	function remove(base: BaseDef): void {
		const label = words.baseDeleted(base.name);
		const group = app.apply(deleteRecords(app.ws, [base.id]), label);
		showToast(label, group?.id ?? null);
	}
</script>

<Menu label={common.more} align="end">
	{#snippet trigger(props)}
		<IconButton {...props} icon="more" label={common.more} tooltip={false} />
	{/snippet}
	<MenuItem icon="arrow-down" onSelect={() => (shell.importing = { into: null })}
		>{words.importFile}</MenuItem
	>
	<MenuItem icon="plus" onSelect={() => (creating = true)}>{words.newBase}</MenuItem>
	{#if bases.length > 0}
		<MenuSeparator />
		{#each bases as base (base.id)}
			<MenuSub label={base.name}>
				<MenuItem icon="plus" onSelect={() => startTable(base.id)}>{words.newTable}</MenuItem>
				<MenuItem icon="pencil" onSelect={() => (renaming = base)}>{common.rename}</MenuItem>
				<MenuItem icon="x" onSelect={() => remove(base)}>{common.delete}</MenuItem>
			</MenuSub>
		{/each}
	{/if}
	{#if !wide.current}
		<MenuSeparator />
		<MenuItem icon="settings" onSelect={() => void goto(SETTINGS)}>{shellWords.settings}</MenuItem>
	{/if}
</Menu>

<NameSheet
	bind:open={creating}
	title={words.newBase}
	placeholder={words.basePlaceholder}
	onsave={(name) => applyWithUndo(createBase(app.ws, name).changes, words.baseCreated(name))}
/>
<NameSheet
	open={renaming !== null}
	onclose={() => (renaming = null)}
	title={words.renameBase}
	initial={renaming?.name ?? ''}
	action={common.rename}
	onsave={(name) => {
		if (renaming !== null)
			applyWithUndo(updateRecord(app.ws, renaming.id, { name }), words.baseRenamed);
	}}
/>
