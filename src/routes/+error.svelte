<script lang="ts">
	import { page } from '$app/state';

	import Logo from '#lib/ui/Logo.svelte';

	const missing = $derived(page.status === 404);
	const heading = $derived(missing ? 'This page does not exist' : 'Something broke on our side');
</script>

<svelte:head>
	<title>{heading} · Torsel</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="flex min-h-dvh flex-col px-gutter py-5 pt-safe">
	<a href="/" class="self-start py-3 text-ink hover:text-ink-2" aria-label="Torsel home">
		<Logo wordmark class="h-4" />
	</a>
	<main class="flex flex-1 flex-col justify-center gap-4 pb-16">
		<p class="text-display leading-none font-semibold tighter text-ink-3">{page.status}</p>
		<h1 class="text-2xl font-semibold tight">{heading}</h1>
		<p class="max-w-prose text-lg text-ink-2">
			{missing
				? 'The link may be old, or the address has a typo. Your data is not affected.'
				: 'The error is ours, not yours. Your data is safe on this device. Try again in a moment.'}
		</p>
		<div class="flex flex-wrap items-center gap-2 pt-2">
			<a
				href="/app"
				class="inline-flex h-cta items-center rounded-box bg-fill px-4 text-lg font-semibold text-on-fill transition-opacity motion hover:opacity-90"
				>Open Torsel</a
			>
			<a
				href="/"
				class="inline-flex h-cta items-center rounded-box px-4 text-lg font-medium text-ink-2 transition-colors motion hover:bg-tint hover:text-ink"
				>Back to the home page</a
			>
		</div>
	</main>
</div>
