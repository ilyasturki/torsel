<script lang="ts">
	import { onMount } from 'svelte';

	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	import { ApiError } from '#lib/client/api.ts';
	import type { PendingAuthorization } from '#lib/client/auth.ts';
	import { answerAuthorization, pendingAuthorization } from '#lib/client/auth.ts';
	import { HOME } from '#lib/client/nav.ts';
	import { signInPath } from '#lib/core/return-path.ts';
	import { authorize as words } from '#lib/i18n/authorize.ts';
	import Button from '#lib/ui/Button.svelte';
	import Logo from '#lib/ui/Logo.svelte';
	import { checkbox, linkButton } from '#lib/ui/styles.ts';

	type Shown =
		| { kind: 'loading' }
		| { kind: 'ask'; request: PendingAuthorization }
		| { kind: 'gone'; title: string; hint: string };

	const id = page.url.searchParams.get('request');

	function refused(reason: string | null): Shown {
		switch (reason) {
			case 'client':
				return { kind: 'gone', title: words.unknownApp, hint: words.startAgain };
			case 'unreachable':
				return { kind: 'gone', title: words.unreachable, hint: words.tryAgain };
			case 'redirect':
				return { kind: 'gone', title: words.badReturn, hint: words.startAgain };
			default:
				return { kind: 'gone', title: words.expired, hint: words.startAgain };
		}
	}

	let shown = $state<Shown>(
		id === null ? refused(page.url.searchParams.get('error')) : { kind: 'loading' }
	);
	let readOnly = $state(false);
	let busy = $state(false);
	let problem = $state('');

	onMount(() => {
		if (id === null) return;
		pendingAuthorization(id).then(
			(request) => {
				readOnly = request.access === 'read';
				shown = { kind: 'ask', request };
			},
			(error: unknown) => {
				if (error instanceof ApiError && error.status === 401) {
					void goto(signInPath(page.url.pathname + page.url.search), { replaceState: true });
				} else if (error instanceof ApiError && error.status === 404) {
					shown = refused(null);
				} else {
					shown = { kind: 'gone', title: words.failed, hint: words.startAgain };
				}
			}
		);
	});

	async function answer(allow: boolean): Promise<void> {
		if (busy || id === null) return;
		busy = true;
		problem = '';
		try {
			location.assign(await answerAuthorization(id, allow, readOnly ? 'read' : 'write'));
		} catch (error) {
			busy = false;
			if (error instanceof ApiError && error.status === 404) {
				shown = refused(null);
			} else {
				problem = words.failed;
			}
		}
	}
</script>

<svelte:head>
	<title>{words.title}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="flex min-h-dvh items-center justify-center px-4 pt-safe pb-safe">
	<div class="flex w-full max-w-sm flex-col gap-3 rounded-panel bg-raised p-6 shadow-raised">
		<div class="mb-1"><Logo wordmark class="h-6" /></div>
		{#if shown.kind === 'ask'}
			{@const request = shown.request}
			<h1 class="text-lg font-semibold text-balance break-words">
				{request.access === 'read'
					? words.wantsRead(request.clientName)
					: words.wantsWrite(request.clientName)}
			</h1>
			<dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
				{#if request.clientHost !== null}
					<dt class="text-ink-2">{words.publisher}</dt>
					<dd class="truncate">{request.clientHost}</dd>
				{/if}
				<dt class="text-ink-2">{words.returnsTo}</dt>
				<dd class="truncate">{request.redirectHost}</dd>
				<dt class="text-ink-2">{words.account}</dt>
				<dd class="truncate">{request.email}</dd>
			</dl>
			{#if request.loopbackOnly}
				<p class="text-sm text-ink-2">{words.loopback}</p>
			{/if}
			{#if request.access === 'write'}
				<label class="flex min-h-control items-center gap-2">
					<input type="checkbox" class={checkbox} bind:checked={readOnly} disabled={busy} />
					{words.readOnly}
				</label>
			{/if}
			<div class="flex gap-2 pt-1">
				<Button class="flex-1" disabled={busy} onclick={() => void answer(false)}>
					{words.deny}
				</Button>
				<Button class="flex-1" variant="primary" disabled={busy} onclick={() => void answer(true)}>
					{words.allow}
				</Button>
			</div>
			{#if problem}<p role="alert">{problem}</p>{/if}
		{:else if shown.kind === 'gone'}
			<h1 class="text-lg font-semibold text-balance">{shown.title}</h1>
			<p class="text-ink-2">{shown.hint}</p>
			<a class="{linkButton} self-start" href={HOME}>{words.openTorsel}</a>
		{/if}
	</div>
</main>
