<script lang="ts">
	import Sparkles from '@lucide/svelte/icons/sparkles';

	import { applyPending, assistant, dismissPending } from '#lib/client/assistant.svelte.ts';
	import { toast, undoToast } from '#lib/client/toast.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';

	const pending = $derived(
		assistant.pending !== null && assistant.pending.tier !== 'apply' ? assistant.pending : null
	);

	let open = $state(false);

	$effect(() => {
		open = pending !== null;
	});

	$effect(() => {
		if (!open && assistant.pending !== null && assistant.pending.tier !== 'apply') {
			dismissPending();
		}
	});
</script>

{#if pending !== null}
	<Sheet
		bind:open
		title={pending.tier === 'confirm' ? 'Confirmer' : 'Proposition de l’IA'}
		description={pending.reply || undefined}
	>
		<ul class="flex flex-col gap-2">
			{#each pending.actions as action, index (index)}
				<li class="flex items-start gap-2 rounded-xl bg-surface-2 px-3 py-2.5 text-[15px]">
					<Sparkles class="mt-1 size-3.5 shrink-0" />
					{action.summary}
				</li>
			{/each}
		</ul>
		{#if pending.tier === 'confirm'}
			<p class="mt-3 text-sm text-ink-muted">Tu pourras encore l’annuler juste après.</p>
		{/if}

		{#snippet footer()}
			<Button onclick={() => (open = false)}
				>{pending.tier === 'confirm' ? 'Garder' : 'Ignorer'}</Button
			>
			<div class="flex-1"></div>
			<Button variant="primary" onclick={applyPending}
				>{pending.tier === 'confirm' ? 'Supprimer' : 'Appliquer'}</Button
			>
		{/snippet}
	</Sheet>
{/if}

{#if toast.text}
	{#key toast.seq}
		<div class="fixed inset-x-0 bottom-24 z-40 flex justify-center px-3 lg:left-64" role="status">
			<div
				class="flex max-w-md items-center gap-3 rounded-2xl bg-fill py-2 pr-2 pl-4 text-on-fill shadow-xl"
			>
				<span class="text-[15px]">{toast.text}</span>
				{#if toast.undo !== null}
					<button
						type="button"
						class="h-9 rounded-xl bg-surface px-3 text-sm font-semibold text-ink"
						onclick={undoToast}>Annuler</button
					>
				{/if}
			</div>
		</div>
	{/key}
{/if}
