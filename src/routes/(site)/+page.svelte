<script lang="ts">
	import { HOME } from '#lib/client/paths.ts';
	import Demo from '#lib/site/landing/Demo.svelte';
	import { structuredDataTag } from '#lib/site/seo.ts';
	import Seo from '#lib/site/Seo.svelte';
	import { REPOSITORY, SITE_DESCRIPTION, SITE_NAME } from '#lib/site/site.ts';

	const panel = 'rounded-panel bg-glass shadow-raised backdrop-blur-glass';
	const cta =
		'inline-flex h-cta shrink-0 items-center rounded-box bg-fill px-5 text-lg font-semibold text-on-fill transition-opacity motion hover:opacity-90';
	const claim = 'text-lg font-semibold tight';
</script>

<Seo title={SITE_NAME} description={SITE_DESCRIPTION} path="/" />

<svelte:head>
	{@html structuredDataTag()}
</svelte:head>

<main class="grid gap-2 max-lg:gap-1.5">
	<section
		class="{panel} grid gap-x-10 gap-y-5 p-5 lg:grid-cols-[1fr_auto] lg:items-end lg:px-8 lg:py-10"
	>
		<h1 class="max-w-headline text-h1 leading-none font-semibold tighter text-balance">
			The spreadsheet that does the work.
		</h1>
		<div class="grid justify-items-start gap-4">
			<p class="text-lg text-balance text-ink-2">
				Ask for a column or a chart. Watch your table change.
			</p>
			<div class="flex items-center gap-3">
				<a class={cta} href={HOME}>Start now</a>
				<span class="text-sm text-ink-2">No account needed</span>
			</div>
		</div>
	</section>

	<Demo />

	<section class="grid gap-2 max-lg:gap-1.5 lg:grid-cols-2">
		<div class="{panel} grid content-start gap-1 p-5 lg:px-6">
			<h2 class={claim}>Works offline</h2>
			<p class="text-ink-2">Turn off your network. Add a row. Reload.</p>
		</div>
		<div class="{panel} grid content-start gap-1 p-5 lg:px-6">
			<h2 class={claim}>Open source</h2>
			<p class="text-ink-2">
				MIT licensed. <a class="text-ink underline underline-offset-3" href={REPOSITORY}
					>Read the code.</a
				>
			</p>
		</div>
	</section>

	<section class="{panel} flex flex-wrap items-center justify-between gap-x-8 gap-y-4 p-5 lg:px-8">
		<h2 class="text-h2 leading-tight font-semibold tighter text-balance">
			Try it on your own data.
		</h2>
		<a class={cta} href={HOME}>Start now</a>
	</section>
</main>
