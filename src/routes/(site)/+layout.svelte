<script lang="ts">
	import font from '@fontsource-variable/funnel-sans/files/funnel-sans-latin-wght-normal.woff2?url';

	import { page } from '$app/state';

	import SiteBackdrop from '#lib/site/landing/SiteBackdrop.svelte';
	import SiteFooter from '#lib/site/SiteFooter.svelte';
	import SiteHeader from '#lib/site/SiteHeader.svelte';

	let { children } = $props();

	// The landing paints its own cells into its sections, the first one running under the header.
	const landing = $derived(page.route.id === '/(site)/[[lang=lang]]');
</script>

<svelte:head>
	<!-- The headline sets its lines in this face: arriving late, it reflows the first screen. -->
	<link rel="preload" href={font} as="font" type="font/woff2" crossorigin="anonymous" />
</svelte:head>

{#if !landing}
	<SiteBackdrop />
{/if}
<!-- A full navigation out: the landing's sample table lives in the same store the app opens. -->
<div class="relative flex min-h-dvh flex-col pt-safe pb-safe" data-sveltekit-reload>
	{#if landing}
		<div class="absolute inset-x-0 top-0 z-10 pt-safe">
			<SiteHeader />
		</div>
		{@render children()}
		<div class="mx-auto w-full max-w-page-gapped p-2 max-lg:p-1.5">
			<SiteFooter />
		</div>
	{:else}
		<SiteHeader />
		<div
			class="mx-auto flex w-full max-w-page-gapped flex-1 flex-col gap-2 p-2 max-lg:gap-1.5 max-lg:p-1.5"
		>
			<div class="flex-1">
				{@render children()}
			</div>
			<SiteFooter />
		</div>
	{/if}
</div>
