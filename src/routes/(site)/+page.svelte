<script lang="ts">
	import { structuredDataTag } from '#lib/site/seo.ts';
	import Seo from '#lib/site/Seo.svelte';
	import { SITE_DESCRIPTION, SITE_NAME } from '#lib/site/site.ts';
	import Logo from '#lib/ui/Logo.svelte';
</script>

<Seo title={SITE_NAME} description={SITE_DESCRIPTION} path="/" />

<svelte:head>
	{@html structuredDataTag()}
</svelte:head>

<main class="flex min-h-dvh flex-col justify-center gap-4 px-gutter">
	<h1><Logo wordmark class="h-6" /></h1>
	<p class="max-w-prose text-ink-2">
		Tables for what you track: workouts, body weight, expenses. Log from your phone, fix from your
		desk.
	</p>
	<a href="/app" class="self-start font-medium underline">Open Torsel</a>
</main>
