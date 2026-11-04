<script lang="ts">
	import font from '@fontsource-variable/funnel-sans/files/funnel-sans-latin-wght-normal.woff2?url';

	import SiteBackdrop from '#lib/site/landing/SiteBackdrop.svelte';
	import SiteFooter from '#lib/site/SiteFooter.svelte';
	import SiteHeader from '#lib/site/SiteHeader.svelte';

	let { children } = $props();
</script>

<svelte:head>
	<!-- The headline sets its lines in this face: arriving late, it reflows the first screen. -->
	<link rel="preload" href={font} as="font" type="font/woff2" crossorigin="anonymous" />
</svelte:head>

<SiteBackdrop />
<!-- A full navigation out: the landing's sample table lives in the same store the app opens. -->
<div class="relative pt-safe pb-safe" data-sveltekit-reload>
	<div
		class="mx-auto flex min-h-dvh max-w-page-gapped flex-col gap-2 p-2 max-lg:gap-1.5 max-lg:p-1.5"
	>
		<SiteHeader />
		<div class="flex-1">
			{@render children()}
		</div>
		<SiteFooter />
	</div>
</div>
