<script lang="ts">
	import { HOME } from '#lib/client/nav.ts';
	import AssistantCards from '#lib/site/landing/AssistantCards.svelte';
	import Stage from '#lib/site/landing/Stage.svelte';
	import Versus from '#lib/site/landing/Versus.svelte';
	import YearBand from '#lib/site/landing/YearBand.svelte';
	import { structuredDataTag } from '#lib/site/seo.ts';
	import Seo from '#lib/site/Seo.svelte';
	import { REPOSITORY, SITE_DESCRIPTION, SITE_NAME } from '#lib/site/site.ts';

	const CLAIMS = [
		{ claim: 'No account to start', check: 'Open the app.' },
		{ claim: 'It works offline', check: 'Turn off your network and keep adding rows.' },
		{ claim: 'Same numbers everywhere', check: 'SQLite on every device and on the server.' },
		{ claim: 'Your data is yours', check: 'Settings exports all of it as JSON.' }
	];

	const panel = 'rounded-panel bg-raised p-4 shadow-raised lg:p-6';
	const heading = 'text-h2 leading-tight font-semibold tighter text-balance';
	const cta =
		'inline-flex h-cta items-center rounded-box bg-fill px-5 text-lg font-semibold text-on-fill transition-opacity motion hover:opacity-90';
	const group = 'grid min-w-0 gap-2 max-lg:gap-1.5';
	const row = 'border-t border-hair max-lg:block max-lg:py-2';
	const claimCell = 'py-2.5 pr-3.5 align-top font-semibold max-lg:block max-lg:p-0 lg:w-1/3';
	const checkCell = 'py-2.5 align-top text-ink-2 max-lg:block max-lg:p-0';
</script>

<Seo title={SITE_NAME} description={SITE_DESCRIPTION} path="/" />

<svelte:head>
	{@html structuredDataTag()}
</svelte:head>

<main class="grid gap-11 max-lg:gap-7">
	<div class={group}>
		<section class="{panel} flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
			<h1 class="max-w-headline text-h1 leading-none font-semibold tighter text-balance">
				Say what you want to track. Get the table, the form and the chart.
			</h1>
			<div class="grid gap-1.5 lg:justify-items-end">
				<a class={cta} href={HOME}>Start now</a>
				<span class="text-sm text-ink-2">No account needed</span>
			</div>
		</section>
		<Stage />
	</div>

	<section class={group}>
		<div class={panel}>
			<h2 class="{heading} mb-3.5">A spreadsheet gives you cells. The rest is up to you.</h2>
			<Versus />
		</div>
	</section>

	<section class={group}>
		<div class={panel}>
			<h2 class={heading}>The assistant works on the data itself.</h2>
		</div>
		<AssistantCards />
	</section>

	<section class={group}>
		<div class="overflow-hidden rounded-panel bg-raised shadow-raised">
			<h2 class="{heading} p-4 pb-3 lg:p-6 lg:pb-3">One cell, one row. Any shape.</h2>
			<YearBand />
		</div>
	</section>

	<section class={group}>
		<div class={panel}>
			<h2 class="{heading} mb-3.5">Check it yourself.</h2>
			<table class="w-full text-lede leading-snug max-lg:block">
				<tbody class="max-lg:block">
					{#each CLAIMS as item (item.claim)}
						<tr class={row}>
							<td class={claimCell}>{item.claim}</td>
							<td class={checkCell}>{item.check}</td>
						</tr>
					{/each}
					<tr class={row}>
						<td class={claimCell}>Open source, MIT, self-hostable</td>
						<td class={checkCell}>
							<a class="text-ink underline underline-offset-3" href={REPOSITORY}>Read the code.</a>
						</td>
					</tr>
				</tbody>
			</table>
		</div>
		<div class="{panel} flex flex-wrap items-center justify-between gap-x-8 gap-y-3.5">
			<h2 class={heading}>Start with one sentence.</h2>
			<a class={cta} href={HOME}>Start now</a>
		</div>
	</section>
</main>
