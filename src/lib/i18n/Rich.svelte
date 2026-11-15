<script lang="ts">
	import type { Snippet } from 'svelte';

	// A sentence whose `<name>…</name>` parts render through the snippet of that name, so each language orders them its own way.
	let { text, ...tags }: { text: string; [tag: string]: Snippet<[string]> | string } = $props();

	const parts = $derived(
		text
			.split(/(<(\w+)>.*?<\/\2>)/su)
			.reduce<{ tag?: string; text: string }[]>((all, part, index) => {
				if (index % 3 === 2) return all;
				const tagged = /^<(\w+)>(.*)<\/\1>$/su.exec(part);
				all.push(tagged === null ? { text: part } : { tag: tagged[1], text: tagged[2] });
				return all;
			}, [])
	);
</script>

{#each parts as part, index (index)}{#if part.tag === undefined}{part.text}{:else}{@const render =
			tags[part.tag]}{#if typeof render === 'function'}{@render render(part.text)}{/if}{/if}{/each}
