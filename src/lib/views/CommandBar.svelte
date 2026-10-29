<script lang="ts">
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import X from '@lucide/svelte/icons/x';

	import { page } from '$app/state';

	import { assistant, ask } from '#lib/client/assistant.svelte.ts';

	let prompt = $state('');
	let field: HTMLInputElement | undefined = $state();

	const context = $derived({
		base: page.params.base ?? null,
		table: page.params.table ?? null,
		view: page.url.searchParams.get('v')
	});

	const placeholder = $derived(context.table ? 'Demande ou saisis…' : 'Que veux-tu suivre ?');

	async function submit(): Promise<void> {
		const text = prompt.trim();
		if (text === '' || assistant.busy) return;
		prompt = '';
		await ask(text, context);
	}

	function onkeydown(event: KeyboardEvent): void {
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
			event.preventDefault();
			field?.focus();
		}
	}
</script>

<svelte:window {onkeydown} />

<div
	class="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex flex-col items-center gap-2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:left-64"
>
	{#if assistant.reply || assistant.error}
		<div
			class="pointer-events-auto flex w-full max-w-2xl items-start gap-2 rounded-2xl bg-surface px-4 py-3 shadow-lg ring-1 ring-line-soft"
			role="status"
		>
			<Sparkles class="mt-0.5 size-4 shrink-0" />
			<p class="flex-1 text-[15px]">{assistant.error || assistant.reply}</p>
			<button
				type="button"
				class="-m-1 flex size-8 items-center justify-center rounded-full text-ink-muted hover:bg-hover"
				aria-label="Fermer"
				onclick={() => {
					assistant.reply = '';
					assistant.error = '';
				}}><X class="size-4" /></button
			>
		</div>
	{/if}

	<form
		class="pointer-events-auto flex w-full max-w-2xl items-center gap-2 rounded-full bg-surface py-1.5 pr-1.5 pl-4 shadow-lg ring-1 ring-line"
		onsubmit={(event) => {
			event.preventDefault();
			void submit();
		}}
	>
		<Sparkles class="size-4 shrink-0" />
		<label for="command" class="sr-only">Demander à l’IA ou saisir</label>
		<input
			id="command"
			bind:this={field}
			bind:value={prompt}
			class="h-10 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-ink-faint"
			{placeholder}
			autocomplete="off"
			enterkeyhint="send"
		/>
		<span class="hidden text-xs text-ink-faint lg:inline">Ctrl K</span>
		<button
			type="submit"
			class="flex size-10 shrink-0 items-center justify-center rounded-full bg-fill text-on-fill disabled:opacity-40"
			aria-label="Envoyer"
			disabled={assistant.busy || prompt.trim() === ''}
		>
			{#if assistant.busy}
				<LoaderCircle class="size-5 animate-spin" />
			{:else}
				<ArrowUp class="size-5" />
			{/if}
		</button>
	</form>
</div>
