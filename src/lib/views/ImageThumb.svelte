<script lang="ts">
	import { imageStore, imageUrl } from '#lib/client/images.svelte.ts';
	import type { ImageRef } from '#lib/core/images.ts';
	import { images as words } from '#lib/i18n/images.ts';
	import Icon from '#lib/ui/Icon.svelte';

	let {
		base,
		image,
		class: size = 'h-thumb',
		fill = false
	}: {
		base: string;
		image: ImageRef;
		/** The box's height; its width follows the image's own shape. */
		class?: string;
		/** Fills a box the caller shaped, letterboxed, never cropped. */
		fill?: boolean;
	} = $props();

	let src = $state<string | null | undefined>(undefined);

	$effect(() => {
		void imageStore.version;
		const asked = image.id;
		let live = true;
		void imageUrl(base, image).then((url) => {
			if (live && asked === image.id) src = url;
		});
		return () => {
			live = false;
		};
	});
</script>

<span
	class="flex shrink-0 items-center justify-center overflow-hidden rounded-box bg-band {fill
		? 'size-full'
		: size}"
	style={fill ? undefined : `aspect-ratio: ${image.w} / ${image.h}`}
>
	{#if src}
		<img
			{src}
			alt={image.name ?? ''}
			width={image.w}
			height={image.h}
			class="size-full object-contain"
			draggable="false"
		/>
	{:else if src === null}
		<Icon name="image-off" label={words.missing} class="size-3/5 max-h-4 max-w-4 text-ink-3" />
	{/if}
</span>
