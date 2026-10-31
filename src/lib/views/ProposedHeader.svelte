<script lang="ts">
	import type { GhostField } from '#lib/client/assistant.svelte.ts';
	import { accept, reject } from '#lib/client/assistant.svelte.ts';
	import Icon from '#lib/ui/Icon.svelte';

	let { ghost, decides = true }: { ghost: GhostField; decides?: boolean } = $props();

	const button =
		'flex size-control shrink-0 items-center justify-center rounded-box transition-colors motion hover:bg-tint-2';
</script>

<div class="flex h-row items-center bg-tint-2 pl-3 {decides ? '' : 'pr-3'}">
	{#if ghost.field.type === 'formula'}<span class="mr-1">ƒ</span>{/if}
	<span
		class="min-w-0 flex-1 truncate {!decides &&
		(ghost.field.type === 'number' || ghost.field.type === 'formula')
			? 'text-right'
			: 'text-left'}">{ghost.field.name}</span
	>
	{#if decides}
		<button
			type="button"
			class={button}
			aria-label="Accept {ghost.field.name}"
			onclick={() => accept(ghost.action.id)}><Icon name="check" /></button
		>
		<button
			type="button"
			class={button}
			aria-label="Reject {ghost.field.name}"
			onclick={() => reject(ghost.action.id)}><Icon name="x" /></button
		>
	{/if}
</div>
