<script lang="ts">
	import { common } from '#lib/i18n/common.ts';
	import Button from '#lib/ui/Button.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import { input } from '#lib/ui/styles.ts';

	let {
		open = $bindable(false),
		title,
		placeholder = '',
		initial = '',
		action = common.create,
		onsave,
		onclose
	}: {
		open?: boolean;
		title: string;
		placeholder?: string;
		initial?: string;
		action?: string;
		onsave: (name: string) => void;
		onclose?: () => void;
	} = $props();

	let name = $state('');

	$effect(() => {
		if (open) name = initial;
	});

	$effect(() => {
		if (!open) onclose?.();
	});

	function save(): void {
		if (name.trim() === '') return;
		onsave(name.trim());
		open = false;
	}
</script>

<Dialog bind:open {title} dirty={name !== initial} onsubmit={save}>
	<input class={input} bind:value={name} {placeholder} aria-label={title} />

	{#snippet footer()}
		<div class="flex-1"></div>
		<Button variant="primary" disabled={name.trim() === ''} onclick={save}>{action}</Button>
	{/snippet}
</Dialog>
