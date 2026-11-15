<script lang="ts">
	import { page } from '$app/state';

	import { site as t } from '#lib/i18n/site.ts';
	import Closing from '#lib/site/landing/Closing.svelte';
	import Demo from '#lib/site/landing/Demo.svelte';
	import Hero from '#lib/site/landing/Hero.svelte';
	import LogForm from '#lib/site/landing/LogForm.svelte';
	import { Samples } from '#lib/site/landing/samples.svelte.ts';
	import { structuredDataTag } from '#lib/site/seo.ts';
	import Seo from '#lib/site/Seo.svelte';
	import { SITE_NAME } from '#lib/site/site.ts';

	const locale = $derived(page.params.lang ?? 'en');
	// Changing language is a full page load, so one set of samples serves the page's whole life.
	// svelte-ignore state_referenced_locally
	const samples = new Samples(locale);
	const Toast = $derived(samples.Toast);
</script>

<Seo title={SITE_NAME} description={t.description} path="/" {locale} />

<svelte:head>
	{@html structuredDataTag()}
</svelte:head>

<main class="grid gap-24 pt-10 pb-24 max-lg:gap-16 max-lg:pt-8 max-lg:pb-16">
	<Hero />
	<Demo {samples} />
	<LogForm {samples} />
	<Closing />
</main>
{#if Toast !== null}
	<Toast />
{/if}
