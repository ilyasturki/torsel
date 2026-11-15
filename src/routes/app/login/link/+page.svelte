<script lang="ts">
	import { onMount } from 'svelte';

	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	import { verifyLink } from '#lib/client/auth.ts';
	import { SETTINGS } from '#lib/client/nav.ts';
	import { adoptSession } from '#lib/client/sync.svelte.ts';
	import { returnTarget, signInPath } from '#lib/core/return-path.ts';
	import { login as words } from '#lib/i18n/login.ts';
	import Logo from '#lib/ui/Logo.svelte';

	const to = page.url.searchParams.get('to');

	let outcome = $state<'checking' | 'dropped' | 'expired'>('checking');

	onMount(async () => {
		const token = page.url.searchParams.get('token');
		if (token === null) {
			outcome = 'expired';
			return;
		}

		try {
			const { droppedPassword } = await verifyLink(token);
			await adoptSession();
			if (droppedPassword) {
				outcome = 'dropped';
			} else {
				await goto(returnTarget(to), { replaceState: true });
			}
		} catch {
			outcome = 'expired';
		}
	});
</script>

<svelte:head>
	<title>{words.title}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="flex min-h-dvh items-center justify-center px-4 pt-safe pb-safe">
	<div class="flex w-full max-w-sm flex-col gap-3 rounded-panel bg-raised p-6 shadow-raised">
		<div class="mb-1"><Logo wordmark class="h-6" /></div>
		{#if outcome === 'checking'}
			<p role="status" class="text-ink-2">{words.signingIn}</p>
		{:else if outcome === 'dropped'}
			<p role="status">{words.signedIn}</p>
			<p class="text-ink-2">{words.passwordDropped}</p>
			<a class="font-medium underline" href={SETTINGS}>{words.openSettings}</a>
		{:else}
			<p role="alert">{words.linkExpired}</p>
			<a class="font-medium underline" href={signInPath(to)}>{words.backToSignIn}</a>
		{/if}
	</div>
</main>
