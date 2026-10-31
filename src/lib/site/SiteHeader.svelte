<script lang="ts">
	import { onMount } from 'svelte';

	import { HOME, LOGIN } from '#lib/client/nav.ts';
	import Logo from '#lib/ui/Logo.svelte';

	import { REPOSITORY } from './site.ts';

	// Prerendered pages ship signed out and learn the session after hydration: no cookie reaches a static file.
	let signedIn = $state(false);

	onMount(() => {
		fetch('/api/auth/session')
			.then((response) => (response.ok ? response.json() : { user: null }))
			.then((session: { user: unknown }) => (signedIn = session.user !== null))
			.catch(() => undefined);
	});

	const quiet =
		'inline-flex h-control items-center rounded-box px-3 font-medium text-ink-2 transition-colors motion hover:bg-tint hover:text-ink';
</script>

<header
	class="sticky top-0 z-30 flex items-center justify-between gap-3 bg-canvas px-gutter pt-safe"
>
	<a href="/" class="flex h-16 items-center text-ink" aria-label="Torsel home">
		<Logo wordmark class="h-4.5" />
	</a>
	<nav class="flex items-center gap-1" aria-label="Site">
		<a href={REPOSITORY} class="{quiet} max-sm:hidden" rel="me">GitHub</a>
		{#if !signedIn}
			<a href={LOGIN} class={quiet}>Sign in</a>
		{/if}
		<a
			href={HOME}
			class="inline-flex h-control items-center rounded-box bg-fill px-3 font-semibold text-on-fill transition-opacity motion hover:opacity-90"
			>{signedIn ? 'Open Torsel' : 'Start now'}</a
		>
	</nav>
</header>
