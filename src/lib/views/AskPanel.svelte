<script lang="ts">
	import { applyPending, ask, assistant, dismissPending } from '#lib/client/assistant.svelte.ts';
	import type { TableDef, ViewDef } from '#lib/core/model.ts';
	import Button from '#lib/ui/Button.svelte';

	let {
		open = $bindable(false),
		table,
		view
	}: { open?: boolean; table: TableDef | null; view: ViewDef | null } = $props();

	let prompt = $state('');
	let asked = $state('');
	let field: HTMLTextAreaElement | undefined = $state();

	const where = $derived(
		table === null ? 'All tables' : view === null ? table.name : `On ${table.name}, ${view.name}`
	);

	const pending = $derived(
		assistant.pending !== null && assistant.pending.tier !== 'apply' ? assistant.pending : null
	);

	$effect(() => {
		// A hidden element refuses focus until its visibility transition has started.
		if (open) requestAnimationFrame(() => field?.focus());
	});

	async function submit(): Promise<void> {
		const text = prompt.trim();
		if (text === '' || assistant.busy) return;
		prompt = '';
		asked = text;
		await ask(text, {
			base: table?.base ?? null,
			table: table?.id ?? null,
			view: view?.id ?? null
		});
	}

	function onkeydown(event: KeyboardEvent): void {
		if (!open) return;
		if (event.key === 'Escape') {
			open = false;
		} else if (event.key === 'Enter' && !event.shiftKey && event.target === field) {
			event.preventDefault();
			void submit();
		}
	}
</script>

<svelte:window {onkeydown} />

<aside
	class="absolute top-3 right-gutter bottom-5 z-20 flex w-ask flex-col rounded-panel bg-float shadow-float transition-[transform,visibility] motion-slow max-lg:fixed max-lg:inset-0 max-lg:z-30 max-lg:w-auto max-lg:rounded-none max-lg:pt-safe max-lg:pb-safe {open
		? 'visible translate-x-0'
		: 'invisible translate-x-ask-out'}"
	aria-label="Ask"
>
	<div class="flex h-11 shrink-0 items-center gap-2 pr-1.5 pl-4">
		<span class="font-semibold">Ask</span>
		<span class="min-w-0 flex-1 truncate text-ink-3">{where}</span>
		<Button variant="ghost" onclick={() => (open = false)}>Close</Button>
	</div>

	<div class="flex min-h-0 flex-1 flex-col justify-end gap-3 overflow-y-auto px-4 pb-3">
		{#if asked}<p class="font-medium">{asked}</p>{/if}
		{#if assistant.busy}<p class="text-ink-2">Working on it…</p>{/if}
		{#if assistant.reply}<p>{assistant.reply}</p>{/if}
		{#if assistant.error}<p role="alert">{assistant.error}</p>{/if}
		{#if pending !== null}
			<div class="flex flex-col gap-2 rounded-box bg-tint p-3">
				{#if pending.reply}<p>{pending.reply}</p>{/if}
				<ul class="flex flex-col gap-1">
					{#each pending.actions as action, index (index)}
						<li class="font-medium">{action.summary}</li>
					{/each}
				</ul>
				<div class="flex gap-2">
					<Button variant="primary" onclick={applyPending}
						>{pending.tier === 'confirm' ? 'Delete' : 'Accept'}</Button
					>
					<Button onclick={dismissPending}>{pending.tier === 'confirm' ? 'Keep' : 'Reject'}</Button>
				</div>
			</div>
		{/if}
	</div>

	<form
		class="m-2 mt-0 flex shrink-0 items-end gap-2 rounded-box bg-tint p-2"
		onsubmit={(event) => {
			event.preventDefault();
			void submit();
		}}
	>
		<label for="ask-input" class="sr-only">Ask about your tables</label>
		<textarea
			id="ask-input"
			bind:this={field}
			bind:value={prompt}
			rows="2"
			class="min-w-0 flex-1 resize-none bg-transparent outline-none placeholder:text-ink-3"
			placeholder="Ask about your tables"></textarea>
		<Button variant="primary" type="submit" disabled={assistant.busy || prompt.trim() === ''}
			>Send</Button
		>
	</form>
</aside>
