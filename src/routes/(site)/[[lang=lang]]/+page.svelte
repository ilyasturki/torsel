<script lang="ts">
	import { page } from '$app/state';

	import { HOME } from '#lib/client/paths.ts';
	import { siteCopy } from '#lib/i18n/site.ts';
	import Demo from '#lib/site/landing/Demo.svelte';
	import { structuredDataTag } from '#lib/site/seo.ts';
	import Seo from '#lib/site/Seo.svelte';
	import { REPOSITORY, SITE_NAME } from '#lib/site/site.ts';

	const locale = $derived(page.params.lang ?? 'en');
	const t = $derived(siteCopy[locale]);
	const cta =
		'inline-flex h-cta shrink-0 items-center rounded-box bg-fill px-6 text-lg font-semibold text-on-fill transition-opacity motion hover:opacity-90';
</script>

<Seo title={SITE_NAME} description={t.description} path="/" {locale} />

<svelte:head>
	{@html structuredDataTag()}
</svelte:head>

<main class="grid gap-24 pt-10 pb-24 max-lg:gap-16 max-lg:pt-8 max-lg:pb-16">
	<section class="grid justify-items-center gap-5 px-4 text-center lg:-mb-10">
		<h1 class="max-w-headline text-h1 leading-none font-semibold tighter text-balance">
			{t.headline}
		</h1>
		<p class="max-w-md text-lg font-medium text-balance lg:text-xl">{t.lead}</p>
		<a class={cta} href={HOME}>{t.start}</a>
	</section>

	<Demo {locale} />

	<section
		class="grid justify-items-center gap-6 rounded-panel bg-glass px-5 py-16 text-center shadow-raised backdrop-blur-glass max-lg:py-12"
	>
		<h2 class="text-h2 leading-tight font-semibold tighter text-balance">{t.closeTitle}</h2>
		<p class="max-w-md text-lg text-balance text-ink-2">
			{t.closeLead}
			<a class="text-ink underline underline-offset-3" href={REPOSITORY}>{t.code}</a>
		</p>
		<a class={cta} href={HOME}>{t.start}</a>
	</section>
</main>
