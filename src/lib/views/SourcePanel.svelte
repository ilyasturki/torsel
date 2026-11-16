<script lang="ts">
	import { ApiError } from '#lib/client/api.ts';
	import { timeFrom } from '#lib/client/format.ts';
	import {
		changeLinked,
		readLinked,
		refreshing,
		refreshLinked,
		unlink
	} from '#lib/client/sources.ts';
	import { showToast } from '#lib/client/toast.svelte.ts';
	import type { Every, Missing, SourceState } from '#lib/core/source.ts';
	import { EVERY, MISSING, sourceName } from '#lib/core/source.ts';
	import { sources as words } from '#lib/i18n/sources.ts';
	import Button from '#lib/ui/Button.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import Segmented from '#lib/ui/Segmented.svelte';
	import { focus, input, menuItem } from '#lib/ui/styles.ts';

	// `name` heads the panel where nothing else names the source, as in the popover.
	let { table, name, onstop }: { table: string; name?: string; onstop?: () => void } = $props();

	let source = $state<SourceState | null>(null);
	let key = $state('');
	let link = $state('');
	let editing = $state(false);
	let problem = $state('');
	let sure = $state(false);

	const running = $derived(refreshing.has(table));

	$effect(() => {
		readLinked(table).then(
			(state) => (source = state),
			(error) => (problem = error instanceof ApiError ? error.message : '')
		);
	});

	function problemText(code: string | null): string {
		const text = code === null ? undefined : words.problems[code as keyof typeof words.problems];
		return typeof text === 'string' ? text : '';
	}

	async function act(work: () => Promise<{ source: SourceState | null } | void>): Promise<void> {
		problem = '';
		try {
			const done = await work();
			if (done !== undefined && done.source !== null) source = done.source;
		} catch (error) {
			problem = error instanceof ApiError ? error.message : '';
		}
	}

	async function saveKey(): Promise<void> {
		if (key.trim() === '') return;
		await act(() => changeLinked(table, { secret: key.trim() }));
		key = '';
	}

	async function saveLink(): Promise<void> {
		if (link.trim() === '') return;
		await act(() => changeLinked(table, { url: link.trim() }));
		editing = problem !== '';
	}

	async function stop(): Promise<void> {
		if (!sure) {
			sure = true;
			return;
		}
		await act(async () => {
			await unlink(table);
			showToast(words.stopped);
			onstop?.();
		});
	}

	const when = $derived.by(() => {
		if (running) return words.refreshing;
		if (source?.lastOkAt == null) return words.never;
		const last = words.refreshed(timeFrom(source.lastOkAt));
		return source.nextAt == null ? last : words.refreshedNext(last, timeFrom(source.nextAt));
	});
</script>

<div class="flex flex-col gap-3" data-testid="source">
	{#if source !== null}
		<div class="flex items-center gap-2">
			<div class="flex min-w-0 flex-1 flex-col">
				{#if name !== undefined}
					<span class="truncate font-semibold" title={source.url}>{sourceName(source.url)}</span>
				{/if}
				<span class="truncate text-sm text-ink-2">{when}</span>
			</div>
			<Button onclick={() => void act(() => refreshLinked(table))} disabled={running}
				><Icon name="sync" />{words.refresh}</Button
			>
		</div>

		{#if !running && source.problem !== null && problemText(source.problem) !== ''}
			<p class="flex items-center gap-2 rounded-box bg-tint p-2 text-sm" role="alert">
				<Icon name="warn" class="size-4 text-warn" />{problemText(source.problem)}
			</p>
		{/if}

		{#if source.auth !== 'none'}
			<form
				class="flex gap-2"
				onsubmit={(event) => {
					event.preventDefault();
					void saveKey();
				}}
			>
				<input
					class={input}
					type="password"
					autocomplete="off"
					autocapitalize="off"
					spellcheck="false"
					data-1p-ignore
					aria-label={words.key}
					placeholder={source.hint
						? `…${source.hint}`
						: source.auth === 'basic'
							? words.userPassword
							: words.key}
					bind:value={key}
				/>
				<Button type="submit" disabled={key.trim() === '' || running}>{words.save}</Button>
			</form>
		{/if}

		<div class="flex flex-col gap-1">
			<span class="text-sm font-medium text-ink-2">{words.every}</span>
			<Segmented
				label={words.every}
				items={EVERY.map((every: Every) => ({
					id: every,
					label: words.schedule[every],
					active: source?.every === every,
					onclick: () => void act(() => changeLinked(table, { every }))
				}))}
			/>
		</div>

		<div class="flex flex-col gap-1">
			<span class="text-sm font-medium text-ink-2">{words.missing}</span>
			<Segmented
				label={words.missing}
				items={MISSING.map((missing: Missing) => ({
					id: missing,
					label: words.gone[missing],
					active: source?.missing === missing,
					onclick: () => void act(() => changeLinked(table, { missing }))
				}))}
			/>
		</div>

		<div class="-mx-1 flex flex-col border-t border-rule pt-2">
			{#if editing}
				<form
					class="flex gap-2 px-1"
					onsubmit={(event) => {
						event.preventDefault();
						void saveLink();
					}}
				>
					<input
						class={input}
						aria-label={words.link}
						autocapitalize="off"
						spellcheck="false"
						bind:value={link}
					/>
					<Button type="submit" disabled={link.trim() === '' || running}>{words.save}</Button>
				</form>
			{:else}
				<button
					type="button"
					class="{menuItem} hover:bg-tint-2 {focus}"
					onclick={() => {
						link = source?.url ?? '';
						editing = true;
					}}><Icon name="url" />{words.editLink}</button
				>
			{/if}
			<button type="button" class="{menuItem} hover:bg-tint-2 {focus}" onclick={() => void stop()}
				><Icon name="x" />{sure ? words.stopSure : words.stop}</button
			>
		</div>
	{/if}

	{#if problem}
		<p class="text-sm text-ink-2" role="alert">{problem}</p>
	{/if}
</div>
