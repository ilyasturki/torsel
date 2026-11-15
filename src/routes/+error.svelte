<script lang="ts">
	import { page } from '$app/state';

	import { home as words } from '#lib/i18n/home.ts';
	import Logo from '#lib/ui/Logo.svelte';

	const missing = $derived(page.status === 404);
	const heading = $derived(missing ? words.pageMissing : words.pageBroke);
</script>

<svelte:head>
	<title>{heading} · Torsel</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="flex min-h-dvh flex-col px-gutter py-5 pt-safe">
	<a href="/" class="self-start py-3 text-ink hover:text-ink-2" aria-label={words.torselHome}>
		<Logo wordmark class="h-4" />
	</a>
	<main class="flex flex-1 flex-col justify-center gap-4 pb-16">
		<p class="text-display leading-none font-semibold tighter text-ink-3">{page.status}</p>
		<h1 class="text-2xl font-semibold tight">{heading}</h1>
		<p class="max-w-prose text-lg text-ink-2">
			{missing ? words.pageMissingBody : words.pageBrokeBody}
		</p>
		<div class="flex flex-wrap items-center gap-2 pt-2">
			<a
				href="/app"
				class="inline-flex h-cta items-center rounded-box bg-fill px-4 text-lg font-semibold text-on-fill transition-opacity motion hover:opacity-90"
				>{words.openTorsel}</a
			>
			<a
				href="/"
				class="inline-flex h-cta items-center rounded-box px-4 text-lg font-medium text-ink-2 transition-colors motion hover:bg-tint hover:text-ink"
				>{words.backHome}</a
			>
		</div>
	</main>
</div>
