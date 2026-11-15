<script lang="ts">
	import { onMount } from 'svelte';

	import { page } from '$app/state';

	import { HOME, LOGIN } from '#lib/client/paths.ts';
	import { siteCopy } from '#lib/i18n/site.ts';
	import Logo from '#lib/ui/Logo.svelte';

	import { REPOSITORY, localePath } from './site.ts';

	const locale = $derived(page.params.lang ?? 'en');
	const t = $derived(siteCopy[locale]);

	// The page renders signed out and learns the session after hydration.
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

<!-- The app header's geometry, so the mark and the buttons hold still when the app opens. -->
<header
	class="flex min-h-13 items-center justify-between gap-3 bg-glass px-gutter py-2.5 shadow-raised backdrop-blur-glass max-sm:pr-2"
>
	<a href={localePath(locale, '/')} class="text-ink" aria-label={t.home}>
		<Logo wordmark class="h-4" />
	</a>
	<nav class="flex items-center gap-1" aria-label={t.siteNav}>
		<a href={REPOSITORY} class="{quiet} max-sm:hidden" rel="me">{t.github}</a>
		{#if !signedIn}
			<a href={LOGIN} class={quiet}>{t.signIn}</a>
		{/if}
		<a
			href={HOME}
			class="inline-flex h-control items-center rounded-box bg-fill px-3 font-semibold text-on-fill transition-opacity motion hover:opacity-90"
			>{signedIn ? t.open : t.start}</a
		>
	</nav>
</header>
