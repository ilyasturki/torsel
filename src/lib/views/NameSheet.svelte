<script lang="ts">
	import Button from '#lib/ui/Button.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';
	import { input } from '#lib/ui/styles.ts';

	let {
		open = $bindable(false),
		title,
		placeholder = '',
		initial = '',
		action = 'Créer',
		onsave
	}: {
		open?: boolean;
		title: string;
		placeholder?: string;
		initial?: string;
		action?: string;
		onsave: (name: string) => void;
	} = $props();

	let name = $state('');

	$effect(() => {
		if (open) name = initial;
	});

	function save(): void {
		if (name.trim() === '') return;
		onsave(name.trim());
		open = false;
	}
</script>

<Sheet bind:open {title}>
	<form
		onsubmit={(event) => {
			event.preventDefault();
			save();
		}}
	>
		<!-- svelte-ignore a11y_autofocus -->
		<input class={input} bind:value={name} {placeholder} aria-label={title} autofocus />
	</form>

	{#snippet footer()}
		<div class="flex-1"></div>
		<Button variant="primary" disabled={name.trim() === ''} onclick={save}>{action}</Button>
	{/snippet}
</Sheet>
