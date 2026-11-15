<script lang="ts">
	import { alternates, fullTitle, metaTags, type PageMeta } from './seo.ts';
	import { canonical, localePath } from './site.ts';

	let { title, description, path, locale }: PageMeta = $props();
</script>

<svelte:head>
	<title>{fullTitle(title)}</title>
	<link rel="canonical" href={canonical(localePath(locale, path))} />
	{#each alternates(path) as { hreflang, href } (hreflang)}
		<link rel="alternate" {hreflang} {href} />
	{/each}
	{#each metaTags({ title, description, path, locale }) as tag (Object.values(tag).join())}
		<meta {...tag} />
	{/each}
</svelte:head>
