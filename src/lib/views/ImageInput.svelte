<script lang="ts">
	import { MediaQuery } from 'svelte/reactivity';

	import { addImages, addLinks, fetchesLinks } from '#lib/client/images.svelte.ts';
	import type { ImageRef } from '#lib/core/images.ts';
	import { imageLinks, imagesOf, imagesValue } from '#lib/core/images.ts';
	import type { FieldDef, Value } from '#lib/core/model.ts';
	import { images as words } from '#lib/i18n/images.ts';
	import Icon from '#lib/ui/Icon.svelte';
	import IconButton from '#lib/ui/IconButton.svelte';
	import Menu from '#lib/ui/Menu.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import { focus, input, secondary } from '#lib/ui/styles.ts';

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
		/** Takes images added once they are ready, for a caller whose row may have changed meanwhile; `shown` is false once this input has left the screen. */
		onadd?: (added: ImageRef[], shown: boolean) => void;
	} = $props();

	// A phone offers its camera; a desktop's "Add" opens the file picker straight away.
	const touch = new MediaQuery('pointer: coarse', false);

	const images = $derived(imagesOf(value));

	let picker: HTMLInputElement | undefined = $state();
	let camera: HTMLInputElement | undefined = $state();
	let viewing = $state(false);
	let at = $state(0);
	let dropping = $state(false);
	let linking = $state(false);
	let fetching = $state(false);
	let mounted = true;

	$effect(() => () => {
		mounted = false;
	});

	function settle(added: ImageRef[]): void {
		if (added.length === 0) return;
		if (onadd === undefined) value = imagesValue([...imagesOf(value), ...added]);
		else onadd(added, mounted);
	}

	async function add(files: File[]): Promise<void> {
		const shown = files.filter((file) => file.type.startsWith('image/') || file.type === '');
		if (shown.length === 0) return;
		settle(await addImages(field.base, shown, images.length));
	}

	async function fetchFrom(text: string): Promise<boolean> {
		const links = imageLinks(text);
		if (links.length === 0 || fetching) return false;
		fetching = true;
		try {
			settle(await addLinks(field.base, links, images.length));
		} finally {
			fetching = false;
		}
		return true;
	}

	function onlinkkey(event: KeyboardEvent): void {
		const box = event.currentTarget as HTMLInputElement;
		if (event.key === 'Enter') {
			event.preventDefault();
			void fetchFrom(box.value).then((fetched) => {
				if (fetched) linking = false;
			});
		} else if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			linking = false;
		}
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
			return;
		}
		const text = event.clipboardData?.getData('text/plain') ?? '';
		if (!linking && fetchesLinks() && imageLinks(text).length > 0) {
			event.preventDefault();
			void fetchFrom(text);
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

	{#if linking}
		<!-- svelte-ignore a11y_autofocus -->
		<input
			type="url"
			class="{input} basis-60 self-center"
			placeholder={words.imageLink}
			aria-label={words.imageLink}
			aria-busy={fetching}
			disabled={fetching}
			autofocus
			onkeydown={onlinkkey}
			onblur={(event) => {
				if (!fetching && event.currentTarget.value.trim() === '') linking = false;
			}}
		/>
	{:else if touch.current}
		<Menu label={words.addImage}>
			{#snippet trigger(props)}
				<button {...props} type="button" class={tile}>
					<Icon name="plus" />{words.add}
				</button>
			{/snippet}
			<MenuItem icon="camera" onSelect={() => camera?.click()}>{words.takePhoto}</MenuItem>
			<MenuItem icon="image" onSelect={() => picker?.click()}>{words.chooseImage}</MenuItem>
			{#if fetchesLinks()}
				<MenuItem icon="url" onSelect={() => (linking = true)}>{words.fromLink}</MenuItem>
			{/if}
		</Menu>
	{:else}
		<button type="button" class={tile} onclick={() => picker?.click()}>
			<Icon name="plus" />{words.add}
		</button>
		{#if fetchesLinks()}
			<IconButton
				icon="url"
				label={words.addFromLink}
				variant="secondary"
				class="self-center"
				onclick={() => (linking = true)}
			/>
		{/if}
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
