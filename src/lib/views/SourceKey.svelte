<script lang="ts">
	import { ApiError } from '#lib/client/api.ts';
	import { changeLinked, readLinked } from '#lib/client/sources.ts';
	import { SOURCE } from '#lib/core/access.ts';
	import type { SourceState } from '#lib/core/source.ts';
	import type { ThreadAction } from '#lib/core/thread.ts';
	import { sources as words } from '#lib/i18n/sources.ts';
	import Button from '#lib/ui/Button.svelte';
	import { input } from '#lib/ui/styles.ts';

	let { action }: { action: ThreadAction } = $props();

	const table = $derived(
		action.changes.find((change) => change.kind === 'table' && change.set[SOURCE] != null)?.id
	);

	let source = $state<SourceState | null>(null);
	let key = $state('');
	let busy = $state(false);
	let problem = $state('');

	$effect(() => {
		if (table === undefined || action.status !== 'applied') return;
		readLinked(table).then(
			(state) => (source = state),
			() => (source = null)
		);
	});

	// A key refused stays asked for: the person typed a wrong one.
	const asks = $derived(
		action.status === 'applied' &&
			source !== null &&
			source.auth !== 'none' &&
			(!source.hasKey || source.problem === 'auth')
	);

	function problemText(code: string): string {
		const text = words.problems[code as keyof typeof words.problems];
		return typeof text === 'string' ? text : '';
	}

	async function connect(): Promise<void> {
		if (table === undefined || key.trim() === '' || busy) return;
		busy = true;
		problem = '';
		try {
			const ran = await changeLinked(table, { secret: key.trim() });
			source = ran.source;
			key = '';
			if (ran.outcome !== null && !ran.outcome.ok) problem = problemText(ran.outcome.problem);
		} catch (error) {
			problem = error instanceof ApiError ? error.message : '';
		} finally {
			busy = false;
		}
	}
</script>

{#if asks}
	<form
		class="flex flex-col gap-1 px-2 pb-2 pl-8"
		onsubmit={(event) => {
			event.preventDefault();
			void connect();
		}}
	>
		<div class="flex gap-2">
			<input
				class={input}
				type="password"
				autocomplete="off"
				autocapitalize="off"
				spellcheck="false"
				data-1p-ignore
				aria-label={words.key}
				placeholder={source?.auth === 'basic' ? words.userPassword : words.key}
				bind:value={key}
			/>
			<Button type="submit" variant="primary" disabled={key.trim() === '' || busy}
				>{words.connect}</Button
			>
		</div>
		{#if problem}
			<p class="text-sm text-ink-2" role="alert">{problem}</p>
		{/if}
	</form>
{/if}
