<script lang="ts">
	import { ApiError } from '#lib/client/api.ts';
	import { timeFrom } from '#lib/client/format.ts';
	import { changeLinked, readLinked, refreshLinked, unlink } from '#lib/client/sources.ts';
	import { showToast } from '#lib/client/toast.svelte.ts';
	import type { Every, Missing, SourceState } from '#lib/core/source.ts';
	import { EVERY, MISSING } from '#lib/core/source.ts';
	import { sources as words } from '#lib/i18n/sources.ts';
	import Button from '#lib/ui/Button.svelte';
	import Segmented from '#lib/ui/Segmented.svelte';
	import { input } from '#lib/ui/styles.ts';

	let { table, onstop }: { table: string; onstop?: () => void } = $props();

	let source = $state<SourceState | null>(null);
	let running = $state(false);
	let key = $state('');
	let problem = $state('');
	let sure = $state(false);

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

	async function refresh(): Promise<void> {
		running = true;
		await act(() => refreshLinked(table));
		running = false;
	}

	function schedule(every: Every): void {
		void act(() => changeLinked(table, { every }));
	}

	function gone(missing: Missing): void {
		void act(() => changeLinked(table, { missing }));
	}

	async function saveKey(): Promise<void> {
		if (key.trim() === '') return;
		running = true;
		await act(() => changeLinked(table, { secret: key.trim() }));
		key = '';
		running = false;
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

	const when = $derived(
		running
			? words.refreshing
			: source?.lastOkAt != null
				? words.refreshed(timeFrom(source.lastOkAt))
				: words.never
	);
</script>

<div class="flex flex-col gap-3" data-testid="source">
	{#if source !== null}
		<div class="flex items-center gap-2">
			<span class="min-w-0 flex-1 truncate text-sm text-ink-2" title={source.url}>{when}</span>
			<Button onclick={refresh} disabled={running}>{words.refresh}</Button>
		</div>

		{#if source.problem !== null && problemText(source.problem) !== ''}
			<p class="text-sm text-ink-2" role="alert">{problemText(source.problem)}</p>
		{/if}

		<div class="flex flex-col gap-1">
			<span class="text-sm font-medium text-ink-2">{words.every}</span>
			<Segmented
				label={words.every}
				items={EVERY.map((every) => ({
					id: every,
					label: words.schedule[every],
					active: source?.every === every,
					onclick: () => schedule(every)
				}))}
			/>
		</div>

		<div class="flex flex-col gap-1">
			<span class="text-sm font-medium text-ink-2">{words.missing}</span>
			<Segmented
				label={words.missing}
				items={MISSING.map((missing) => ({
					id: missing,
					label: words.gone[missing],
					active: source?.missing === missing,
					onclick: () => gone(missing)
				}))}
			/>
		</div>

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

		<Button variant="ghost" class="self-start" onclick={stop}
			>{sure ? words.stopSure : words.stop}</Button
		>
	{/if}

	{#if problem}
		<p class="text-sm text-ink-2" role="alert">{problem}</p>
	{/if}
</div>
