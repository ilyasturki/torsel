<script lang="ts">
	import {
		accept,
		canUndo,
		ghostTable,
		markFresh,
		reject,
		undoAction
	} from '#lib/client/assistant.svelte.ts';
	import { app } from '#lib/client/app.svelte.ts';
	import { HOME, tableUrl } from '#lib/client/nav.ts';
	import type { Item, ThreadAction } from '#lib/core/thread.ts';
	import { errorOf } from '#lib/core/thread.ts';
	import Button from '#lib/ui/Button.svelte';
	import Icon from '#lib/ui/Icon.svelte';

	let {
		item,
		busy,
		onopen
	}: {
		item: Extract<Item, { kind: 'tool' }>;
		busy: boolean;
		onopen: () => void;
	} = $props();

	const action = $derived(item.action);
	const failure = $derived(item.state === 'error' ? errorOf(item.output) : null);

	const state = $derived.by(() => {
		if (item.state === 'running') return busy ? 'Running' : 'Stopped';
		if (item.state === 'error') return 'Failed';
		if (action === null) return '';
		if (action.tier === 'apply') {
			return { pending: 'Waiting', applied: 'Applied', rejected: 'Not applied', undone: 'Undone' }[
				action.status
			];
		}
		if (action.tier === 'propose') {
			return { pending: 'Proposed', applied: 'Accepted', rejected: 'Rejected', undone: 'Undone' }[
				action.status
			];
		}
		return { pending: 'Asks first', applied: 'Deleted', rejected: 'Kept', undone: 'Undone' }[
			action.status
		];
	});

	const struck = $derived(action?.status === 'rejected' || action?.status === 'undone');

	function pretty(value: unknown): string {
		if (typeof value === 'string') {
			try {
				return JSON.stringify(JSON.parse(value), null, 2);
			} catch {
				return value;
			}
		}
		return JSON.stringify(value, null, 2);
	}

	function target(of: ThreadAction): { href: string; name: string } | null {
		void app.version;
		if (of.status === 'rejected' || of.status === 'undone') return null;
		const made = of.changes.find((change) => change.kind === 'table');
		const view = of.changes.find((change) => change.kind === 'view');
		if (
			made === undefined &&
			view !== undefined &&
			of.tier !== 'confirm' &&
			ghostTable(view.parent) === undefined
		) {
			const name = view.set.name;
			return {
				href: tableUrl(view.parent, view.id),
				name: typeof name === 'string' ? name : 'view'
			};
		}
		const change = made ?? of.changes.find((candidate) => candidate.kind !== 'base');
		const tableId =
			change === undefined ? null : change.kind === 'table' ? change.id : change.parent;
		const table =
			tableId === null ? undefined : (app.ws.table(tableId) ?? ghostTable(tableId)?.table);
		if (table !== undefined) {
			return { href: tableUrl(table.id), name: table.name };
		}
		return of.status === 'applied' && of.changes.some((candidate) => candidate.kind === 'base')
			? { href: HOME, name: 'tables' }
			: null;
	}

	const link = $derived(action === null ? null : target(action));
</script>

<div class="flex flex-col rounded-box bg-tint">
	<details class="group">
		<summary
			class="flex min-h-row cursor-pointer list-none items-center gap-2 px-2 py-1 select-none [&::-webkit-details-marker]:hidden"
		>
			<Icon
				name="chevron"
				class="size-3 text-ink-3 transition-transform motion group-open:rotate-90"
			/>
			<span class="min-w-0 flex-1 truncate font-medium {struck ? 'text-ink-3 line-through' : ''}"
				>{item.label}</span
			>
			{#if state}<span class="shrink-0 text-sm text-ink-3">{state}</span>{/if}
		</summary>
		<div class="flex flex-col gap-1 px-2 pb-2">
			<p class="text-xs text-ink-3">Input</p>
			<pre
				class="max-h-48 overflow-auto rounded-box bg-tint p-2 font-mono text-xs break-words whitespace-pre-wrap">{pretty(
					item.input
				)}</pre>
			{#if item.output !== null}
				<p class="text-xs text-ink-3">Result</p>
				<pre
					class="max-h-48 overflow-auto rounded-box bg-tint p-2 font-mono text-xs break-words whitespace-pre-wrap">{pretty(
						item.output
					)}</pre>
			{/if}
		</div>
	</details>

	{#if failure}
		<p class="px-2 pb-2 pl-7 text-ink-2">{failure}</p>
	{/if}

	{#if action !== null}
		{#if action.detail.length > 0 && action.status === 'pending'}
			<ul class="flex flex-col gap-0.5 px-2 pb-2 pl-7 text-ink-2">
				{#each action.detail as line, index (index)}
					<li class="break-words">{line}</li>
				{/each}
			</ul>
		{/if}
		{#if action.status === 'pending' && action.tier === 'apply'}
			<p class="px-2 pb-2 pl-7 text-ink-2">Held until you answer on what it builds on.</p>
		{/if}
		{#if action.status === 'pending' && action.tier !== 'apply'}
			<div class="flex flex-wrap items-center gap-2 px-2 pb-2 pl-7">
				<Button variant="primary" onclick={() => accept(action.id)}
					>{action.tier === 'confirm' ? 'Delete' : 'Accept'}</Button
				>
				<Button onclick={() => reject(action.id)}
					>{action.tier === 'confirm' ? 'Keep' : 'Reject'}</Button
				>
				{#if link !== null && action.tier === 'propose'}
					<a class="text-ink-2 underline" href={link.href} onclick={onopen}>Show in {link.name}</a>
				{/if}
			</div>
		{:else if action.status === 'applied'}
			<div class="flex flex-wrap items-center gap-2 px-2 pb-2 pl-7">
				{#if link !== null}
					<a
						class="text-ink-2 underline"
						href={link.href}
						onclick={() => {
							markFresh(action);
							onopen();
						}}>Open {link.name}</a
					>
				{/if}
				{#if canUndo(action)}
					<button type="button" class="text-ink-2 underline" onclick={() => undoAction(action)}
						>Undo</button
					>
				{/if}
			</div>
		{/if}
	{/if}
</div>
