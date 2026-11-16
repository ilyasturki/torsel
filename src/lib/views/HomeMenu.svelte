<script lang="ts">
	import { app } from '#lib/client/app.svelte.ts';
	import { SETTINGS } from '#lib/client/nav.ts';
	import { shell, startTable } from '#lib/client/shell.svelte.ts';
	import { applyWithUndo, showToast } from '#lib/client/toast.svelte.ts';
	import { createBase, deleteRecords, updateRecord } from '#lib/core/actions.ts';
	import type { BaseDef } from '#lib/core/model.ts';
	import { common } from '#lib/i18n/common.ts';
	import { home as words } from '#lib/i18n/home.ts';
	import { shell as shellWords } from '#lib/i18n/shell.ts';
	import Button from '#lib/ui/Button.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import IconButton from '#lib/ui/IconButton.svelte';
	import { wide } from '#lib/ui/media.svelte.ts';
	import Menu from '#lib/ui/Menu.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import MenuSeparator from '#lib/ui/MenuSeparator.svelte';
	import MenuSub from '#lib/ui/MenuSub.svelte';

	import NameSheet from './NameSheet.svelte';

	let open = $state(false);
	let creating = $state(false);
	let renaming = $state<BaseDef | null>(null);

	const bases = $derived.by(() => {
		void app.version;
		return app.ws.bases();
	});

	function run(action: () => void): void {
		open = false;
		action();
	}

	const importFile = (): void => {
		shell.importing = { into: null };
	};

	function remove(base: BaseDef): void {
		const label = words.baseDeleted(base.name);
		const group = app.apply(deleteRecords(app.ws, [base.id]), label);
		showToast(label, group?.id ?? null);
	}
</script>

{#if wide.current}
	<Menu bind:open label={common.more} align="end">
		{#snippet trigger(props)}
			<IconButton {...props} icon="more" label={common.more} tooltip={false} />
		{/snippet}
		<MenuItem icon="arrow-down" onSelect={importFile}>{words.importFile}</MenuItem>
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
	</Menu>
{:else}
	<IconButton icon="more" label={common.more} tooltip={false} onclick={() => (open = true)} />
	<Dialog bind:open title={shellWords.tables}>
		<div class="-mx-2 flex flex-col items-stretch">
			<Button variant="ghost" class="justify-start" onclick={() => run(importFile)}
				>{words.importFile}</Button
			>
			<Button variant="ghost" class="justify-start" onclick={() => run(() => (creating = true))}
				>{words.newBase}</Button
			>
			<a
				href={SETTINGS}
				class="inline-flex h-control items-center rounded-box px-3 font-medium text-ink-2 transition-colors motion hover:bg-tint hover:text-ink"
				onclick={() => (open = false)}>{shellWords.settings}</a
			>
			{#each bases as base (base.id)}
				<div class="flex flex-col pt-2" role="group" aria-labelledby="base-{base.id}">
					<span class="px-3 text-sm text-ink-3" id="base-{base.id}">{base.name}</span>
					<div class="flex flex-wrap">
						<Button variant="ghost" onclick={() => run(() => startTable(base.id))}
							>{words.newTable}</Button
						>
						<Button variant="ghost" onclick={() => run(() => (renaming = base))}
							>{common.rename}</Button
						>
						<Button variant="ghost" onclick={() => run(() => remove(base))}>{common.delete}</Button>
					</div>
				</div>
			{/each}
		</div>
	</Dialog>
{/if}

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
