<script lang="ts">
	import { MediaQuery } from 'svelte/reactivity';

	import { addImages } from '#lib/client/images.svelte.ts';
	import type { ImageRef } from '#lib/core/images.ts';
	import { imagesOf, imagesValue } from '#lib/core/images.ts';
	import type { FieldDef, Value } from '#lib/core/model.ts';
	import { images as words } from '#lib/i18n/images.ts';
	import Icon from '#lib/ui/Icon.svelte';
	import IconButton from '#lib/ui/IconButton.svelte';
	import Menu from '#lib/ui/Menu.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import { focus, secondary } from '#lib/ui/styles.ts';

	import ImageThumb from './ImageThumb.svelte';
	import ImageViewer from './ImageViewer.svelte';

	let {
		field,
		value = $bindable(),
		id,
		onadd
	}: {
		field: FieldDef;
		value?: Value;
		id?: string;
		/** Takes images added once they are ready, for a caller whose row may have changed meanwhile. */
		onadd?: (added: ImageRef[]) => void;
	} = $props();

	// A phone offers its camera; a desktop's "Add" opens the file picker straight away.
	const touch = new MediaQuery('pointer: coarse', false);

	const images = $derived(imagesOf(value));

	let picker: HTMLInputElement | undefined = $state();
	let camera: HTMLInputElement | undefined = $state();
	let viewing = $state(false);
	let at = $state(0);
	let dropping = $state(false);

	async function add(files: File[]): Promise<void> {
		const shown = files.filter((file) => file.type.startsWith('image/') || file.type === '');
		if (shown.length === 0) return;
		const added = await addImages(field.base, shown, images.length);
		if (added.length === 0) return;
		if (onadd === undefined) value = imagesValue([...imagesOf(value), ...added]);
		else onadd(added);
	}

	function remove(index: number): void {
		value = imagesValue(images.filter((_, other) => other !== index));
	}

	function picked(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		void add([...(input.files ?? [])]);
		input.value = '';
	}

	const hasFiles = (event: DragEvent): boolean =>
		event.dataTransfer?.types.includes('Files') === true;

	const tile = `flex h-picture items-center justify-center gap-2 rounded-box px-4 font-medium transition-colors motion ${secondary} ${focus}`;
</script>

<div
	class="flex min-w-0 flex-wrap items-start gap-2 rounded-box {dropping
		? 'ring-2 ring-accent ring-offset-2 ring-offset-float'
		: ''}"
	{id}
	role="group"
	aria-label={field.name}
	onpaste={(event) => {
		const files = [...(event.clipboardData?.files ?? [])];
		if (files.length > 0) {
			event.preventDefault();
			void add(files);
		}
	}}
	ondragover={(event) => {
		if (hasFiles(event)) {
			event.preventDefault();
			dropping = true;
		}
	}}
	ondragleave={(event) => {
		if (!event.currentTarget.contains(event.relatedTarget as Node | null)) dropping = false;
	}}
	ondrop={(event) => {
		dropping = false;
		if (hasFiles(event)) {
			event.preventDefault();
			void add([...(event.dataTransfer?.files ?? [])]);
		}
	}}
>
	{#each images as image, index (image.id)}
		<div class="group relative">
			<button
				type="button"
				class="flex cursor-zoom-in rounded-box {focus}"
				aria-label={image.name ?? words.image(index + 1, images.length)}
				onclick={() => {
					at = index;
					viewing = true;
				}}
			>
				<ImageThumb base={field.base} {image} class="h-picture" />
			</button>
			<IconButton
				icon="x"
				label={words.remove(image.name ?? words.image(index + 1, images.length))}
				tooltip={false}
				variant="secondary"
				class="absolute top-1 right-1 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:focus-visible:opacity-100"
				onclick={() => remove(index)}
			/>
		</div>
	{/each}

	{#if touch.current}
		<Menu label={words.addImage}>
			{#snippet trigger(props)}
				<button {...props} type="button" class={tile}>
					<Icon name="plus" />{words.add}
				</button>
			{/snippet}
			<MenuItem icon="camera" onSelect={() => camera?.click()}>{words.takePhoto}</MenuItem>
			<MenuItem icon="image" onSelect={() => picker?.click()}>{words.chooseImage}</MenuItem>
		</Menu>
	{:else}
		<button type="button" class={tile} onclick={() => picker?.click()}>
			<Icon name="plus" />{words.add}
		</button>
	{/if}
	<input
		bind:this={picker}
		type="file"
		accept="image/*"
		multiple
		hidden
		data-images={field.id}
		onchange={picked}
	/>
	<input
		bind:this={camera}
		type="file"
		accept="image/*"
		capture="environment"
		hidden
		onchange={picked}
	/>
</div>

<ImageViewer bind:open={viewing} bind:at base={field.base} {images} label={field.name} />
