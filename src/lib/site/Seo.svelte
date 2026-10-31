<script lang="ts">
	import { fullTitle, metaTags, type PageMeta } from './seo.ts';
	import { canonical } from './site.ts';

	let { title, description, path }: PageMeta = $props();
</script>

<svelte:head>
	<title>{fullTitle(title)}</title>
	<link rel="canonical" href={canonical(path)} />
	{#each metaTags({ title, description, path }) as tag (Object.values(tag)[0])}
		<meta {...tag} />
	{/each}
</svelte:head>
