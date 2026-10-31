<script lang="ts">
	import { page } from '$app/state';

	import {
		acceptAll,
		assistant,
		newThread,
		openThread,
		send,
		showThreads,
		stop
	} from '#lib/client/assistant.svelte.ts';
	import { app } from '#lib/client/app.svelte.ts';
	import { LOGIN } from '#lib/client/nav.ts';
	import { clearSelection, selection } from '#lib/client/selection.svelte.ts';
	import { me } from '#lib/client/session.svelte.ts';
	import type { TableDef, ViewDef } from '#lib/core/model.ts';
	import type { Item } from '#lib/core/thread.ts';
	import { MAX_PROMPT, toItems } from '#lib/core/thread.ts';
	import Button from '#lib/ui/Button.svelte';
	import Markdown from '#lib/ui/Markdown.svelte';

	import ThreadTool from './ThreadTool.svelte';

	let {
		open = $bindable(false),
		table,
		view
	}: { open?: boolean; table: TableDef | null; view: ViewDef | null } = $props();

	let prompt = $state('');
	let field: HTMLTextAreaElement | undefined = $state();
	let scroller: HTMLDivElement | undefined = $state();
	let pinned = $state(true);

	const selected = $derived(table !== null && selection.table === table.id ? selection.rows : []);

	const where = $derived.by(() => {
		if (table === null) return 'All tables';
		const on = view === null ? `On ${table.name}` : `On ${table.name}, ${view.name}`;
		const count = selected.length;
		return count === 0 ? on : `${on}, ${count} row${count === 1 ? '' : 's'} selected`;
	});

	const items = $derived(toItems(assistant.rows, assistant.actions));

	const waiting = $derived(
		assistant.actions.filter((action) => action.status === 'pending' && action.tier === 'propose')
			.length
	);

	const loginHref = $derived(
		`${LOGIN}?to=${encodeURIComponent(page.url.pathname + page.url.search)}`
	);

	$effect(() => {
		// A hidden element refuses focus until its visibility transition has started.
		if (open) requestAnimationFrame(() => field?.focus());
	});

	$effect(() => {
		void items;
		if (pinned && scroller) {
			scroller.scrollTop = scroller.scrollHeight;
		}
	});

	function onscroll(): void {
		if (scroller) {
			pinned = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 48;
		}
	}

	function submit(): void {
		const text = prompt.trim();
		if (text === '' || assistant.busy) return;
		prompt = '';
		pinned = true;
		void send(
			text,
			{
				base: table?.base ?? null,
				table: table?.id ?? null,
				view: view?.id ?? null,
				rows: $state.snapshot(selected)
			},
			where
		);
	}

	function onkeydown(event: KeyboardEvent): void {
		if (!open) return;
		if (event.key === 'Escape') {
			open = false;
		} else if (event.key === 'Enter' && !event.shiftKey && event.target === field) {
			event.preventDefault();
			submit();
		}
	}

	function closeOnPhone(): void {
		if (window.matchMedia('(max-width: 63.99rem)').matches) {
			open = false;
		}
	}

	function whereChanged(at: number): boolean {
		const item = items[at];
		if (item.kind !== 'user') return false;
		const before = items.slice(0, at).findLast((other: Item) => other.kind === 'user');
		return before?.kind !== 'user' || before.where !== item.where;
	}
</script>

<svelte:window {onkeydown} />

<aside
	class="absolute top-3 right-gutter bottom-5 z-20 flex w-ask flex-col rounded-panel bg-float shadow-float transition-[transform,visibility] motion-slow max-lg:fixed max-lg:inset-0 max-lg:z-30 max-lg:w-auto max-lg:rounded-none max-lg:pt-safe max-lg:pb-safe {open
		? 'visible translate-x-0'
		: 'invisible translate-x-ask-out'}"
	aria-label="Ask"
>
	<div class="flex h-11 shrink-0 items-center gap-1 pr-1.5 pl-4">
		<span class="min-w-0 flex-1 truncate font-semibold">{assistant.title || 'Ask'}</span>
		{#if me.account}
			<Button
				variant="ghost"
				class={assistant.listing ? 'bg-tint-2 text-ink' : ''}
				aria-pressed={assistant.listing}
				onclick={() => void showThreads()}>Threads</Button
			>
			<Button variant="ghost" onclick={newThread}>New</Button>
		{/if}
		<Button variant="ghost" onclick={() => (open = false)}>Close</Button>
	</div>

	{#if !me.account}
		<div class="flex flex-1 flex-col gap-2 px-4 pb-4">
			<p class="text-ink-2">
				The assistant works from your account, so its changes reach your tables.
			</p>
			<a class="font-medium underline" href={loginHref}>Sign in to use it</a>
		</div>
	{:else if assistant.listing}
		<div class="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2">
			{#each assistant.threads as thread (thread.id)}
				<button
					type="button"
					class="flex flex-col rounded-box px-2 py-1.5 text-left transition-colors motion hover:bg-tint {thread.id ===
					assistant.id
						? 'bg-tint'
						: ''}"
					onclick={() => void openThread(thread.id)}
				>
					<span class="w-full truncate">{thread.title}</span>
					<span class="text-sm text-ink-3"
						>{new Date(thread.updatedAt).toLocaleString(undefined, {
							dateStyle: 'medium',
							timeStyle: 'short'
						})}</span
					>
				</button>
			{:else}
				<p class="px-2 text-ink-2">No threads yet.</p>
			{/each}
		</div>
	{:else}
		<div
			bind:this={scroller}
			{onscroll}
			class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 pb-3"
			data-testid="thread"
		>
			{#if items.length === 0}
				<p class="text-ink-2">
					Ask about your tables or say what to change. New rows apply at once and can be undone. New
					fields, views and tables wait for your answer, and so does anything it would delete.
				</p>
			{/if}
			{#each items as item, at (item.key)}
				{#if item.kind === 'user'}
					<div class="mt-2 flex flex-col gap-1 first:mt-0">
						{#if whereChanged(at)}<p class="text-xs text-ink-3">{item.where}</p>{/if}
						<p class="rounded-box bg-tint-2 px-3 py-2 font-medium break-words whitespace-pre-wrap">
							{item.text}
						</p>
					</div>
				{:else if item.kind === 'note'}
					<p class="text-ink-2">{item.text}</p>
				{:else if item.kind === 'text'}
					<Markdown text={item.text} />
				{:else if item.kind === 'tool'}
					<ThreadTool {item} busy={assistant.busy} onopen={closeOnPhone} />
				{:else if item.event === 'error'}
					<p role="alert" class="font-medium">{item.message}</p>
				{:else}
					<p class="text-ink-2">{item.message}</p>
				{/if}
			{/each}
			{#if assistant.busy}
				<p class="text-ink-3" role="status">Working…</p>
			{/if}
		</div>

		{#if waiting > 1}
			<div class="flex shrink-0 items-center gap-2 px-4 pb-2">
				<span class="flex-1 text-ink-2">{waiting} proposals waiting</span>
				<Button onclick={acceptAll}>Accept all</Button>
			</div>
		{/if}

		<div class="flex shrink-0 items-center gap-2 px-4 pb-1 text-sm text-ink-3">
			<span class="min-w-0 truncate" data-testid="context">{where}</span>
			{#if selected.length > 0}
				<button type="button" class="shrink-0 underline" onclick={clearSelection}>Clear</button>
			{/if}
		</div>

		<form
			class="m-2 mt-0 flex shrink-0 items-end gap-2 rounded-box bg-tint p-2"
			onsubmit={(event) => {
				event.preventDefault();
				submit();
			}}
		>
			<label for="ask-input" class="sr-only">Ask about your tables</label>
			<textarea
				id="ask-input"
				bind:this={field}
				bind:value={prompt}
				rows="2"
				maxlength={MAX_PROMPT}
				class="min-w-0 flex-1 resize-none bg-transparent outline-none placeholder:text-ink-3"
				placeholder="Ask about your tables"></textarea>
			{#if assistant.busy}
				<Button onclick={stop}>Stop</Button>
			{:else}
				<Button variant="primary" type="submit" disabled={prompt.trim() === ''}>Send</Button>
			{/if}
		</form>
	{/if}
</aside>
