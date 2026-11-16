<script lang="ts">
	import { imageStore, imageUrl } from '#lib/client/images.svelte.ts';
	import type { ImageRef } from '#lib/core/images.ts';
	import type { Shown } from '#lib/ui/Lightbox.svelte';
	import Lightbox from '#lib/ui/Lightbox.svelte';

	let {
		open = $bindable(false),
		at = $bindable(0),
		base,
		images,
		label
	}: { open?: boolean; at?: number; base: string; images: ImageRef[]; label: string } = $props();

	let urls = $state<Record<string, string | null>>({});

	$effect(() => {
		if (!open) return;
		void imageStore.version;
		for (const image of images) {
			void imageUrl(base, image).then((url) => (urls[image.id] = url));
		}
	});

	const items = $derived<Shown[]>(
		images.map((image) => ({
			src: urls[image.id] ?? null,
			alt: image.name ?? label,
			w: image.w,
			h: image.h
		}))
	);
</script>

<Lightbox bind:open bind:at {items} {label} />
