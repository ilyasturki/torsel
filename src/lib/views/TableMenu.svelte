<script lang="ts">
	import { goto } from '$app/navigation';

	import { app } from '#lib/client/app.svelte.ts';
	import { HOME, SETTINGS } from '#lib/client/nav.ts';
	import { shell } from '#lib/client/shell.svelte.ts';
	import { showToast } from '#lib/client/toast.svelte.ts';
	import { deleteRecords } from '#lib/core/actions.ts';
	import type { TableDef } from '#lib/core/model.ts';
	import Button from '#lib/ui/Button.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';

	let {
		open = $bindable(false),
		table,
		onviewsettings,
		onnewview
	}: {
		open?: boolean;
		table: TableDef;
		onviewsettings?: () => void;
		onnewview: () => void;
	} = $props();

	function run(action: () => void): void {
		open = false;
		action();
	}

	function remove(): void {
		const label = `Table "${table.name}" deleted`;
		const group = app.apply(deleteRecords(app.ws, [table.id]), label);
		showToast(label, group?.id ?? null);
		open = false;
		void goto(HOME);
	}
</script>

<Sheet bind:open title={table.name}>
	<div class="-mx-2 flex flex-col items-stretch">
		{#if onviewsettings !== undefined}
			<Button variant="ghost" class="justify-start" onclick={() => run(onviewsettings)}
				>View settings</Button
			>
		{/if}
		<Button variant="ghost" class="justify-start" onclick={() => run(onnewview)}>New view</Button>
		<Button
			variant="ghost"
			class="justify-start"
			onclick={() => run(() => (shell.importing = { into: table.id }))}
			>Import into this table</Button
		>
		<a
			href={SETTINGS}
			class="inline-flex h-control items-center rounded-box px-3 font-medium text-ink-2 transition-colors motion hover:bg-tint hover:text-ink sm:hidden"
			onclick={() => (open = false)}>Settings</a
		>
		<Button variant="ghost" class="justify-start" onclick={remove}>Delete table</Button>
	</div>
</Sheet>
