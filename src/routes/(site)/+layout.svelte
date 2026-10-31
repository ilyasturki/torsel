<script lang="ts">
	import SiteBackdrop from '#lib/site/landing/SiteBackdrop.svelte';
	import SiteFooter from '#lib/site/SiteFooter.svelte';
	import SiteHeader from '#lib/site/SiteHeader.svelte';

	let { children } = $props();
</script>

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
