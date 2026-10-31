<script lang="ts">
	import { onMount } from 'svelte';

	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	import { verifyLink } from '#lib/client/auth.ts';
	import { SETTINGS } from '#lib/client/nav.ts';
	import { adoptSession } from '#lib/client/sync.svelte.ts';
	import { returnTarget, signInPath } from '#lib/core/return-path.ts';
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
	<title>Sign in · Torsel</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="flex min-h-dvh items-center justify-center px-4 pt-safe pb-safe">
	<div class="flex w-full max-w-sm flex-col gap-3 rounded-panel bg-raised p-6 shadow-raised">
		<div class="mb-1"><Logo wordmark class="h-6" /></div>
		{#if outcome === 'checking'}
			<p role="status" class="text-ink-2">Signing you in…</p>
		{:else if outcome === 'dropped'}
			<p role="status">You’re signed in.</p>
			<p class="text-ink-2">
				This link opened in a different browser from the one that created the account, so its
				password was removed. Set a new one in Settings.
			</p>
			<a class="font-medium underline" href={SETTINGS}>Open Settings</a>
		{:else}
			<p role="alert">This link has expired or was already used.</p>
			<a class="font-medium underline" href={signInPath(to)}>Back to sign in</a>
		{/if}
	</div>
</main>
