<script lang="ts">
	import SiteFooter from '#lib/site/SiteFooter.svelte';
	import SiteHeader from '#lib/site/SiteHeader.svelte';

	let { children } = $props();
</script>

<div class="flex min-h-dvh flex-col">
	<SiteHeader />
	<div class="flex-1">
		{@render children()}
	</div>
	<SiteFooter />
</div>
