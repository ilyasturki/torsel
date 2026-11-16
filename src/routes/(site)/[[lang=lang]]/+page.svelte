<script lang="ts">
	import { page } from '$app/state';

	import { site as t } from '#lib/i18n/site.ts';
	import Closing from '#lib/site/landing/Closing.svelte';
	import Demo from '#lib/site/landing/Demo.svelte';
	import Hero from '#lib/site/landing/Hero.svelte';
	import Results from '#lib/site/landing/Results.svelte';
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

<main>
	<Hero />
	<div
		class="mx-auto grid w-full max-w-page-gapped grid-cols-1 gap-28 p-2 pt-20 pb-24 max-lg:gap-20 max-lg:p-1.5 max-lg:pt-16 max-lg:pb-16"
	>
		<section class="grid grid-cols-1 gap-6" aria-labelledby="landing-try">
			<div class="grid gap-2 px-3 lg:px-5">
				<h2 id="landing-try" class="text-h2 leading-tight font-semibold tighter text-balance">
					{t.tryTitle}
				</h2>
				<p class="max-w-xl text-lg text-ink-2">{t.tryLead}</p>
			</div>
			<Demo {samples} />
		</section>
		<Results {samples} />
		<Closing />
	</div>
</main>
{#if Toast !== null}
	<Toast />
{/if}
