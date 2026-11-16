<script lang="ts" module>
	/** One image: `src` undefined while its bytes load, null when they are nowhere to be had; `w`/`h` keep its box the right shape meanwhile. */
	export type Shown = { src: string | null | undefined; alt: string; w: number; h: number };
</script>

<script lang="ts">
	import { Dialog } from 'bits-ui';

	import { images as words } from '#lib/i18n/images.ts';

	import Icon from './Icon.svelte';

	let {
		open = $bindable(false),
		at = $bindable(0),
		items,
		label
	}: { open?: boolean; at?: number; items: Shown[]; label: string } = $props();

	const shown = $derived(items[Math.min(at, items.length - 1)] as Shown | undefined);
	const many = $derived(items.length > 1);

	function step(by: number): void {
		if (many) at = (at + by + items.length) % items.length;
	}

	function onkeydown(event: KeyboardEvent): void {
		if (event.key === 'ArrowRight') {
			event.preventDefault();
			step(1);
		} else if (event.key === 'ArrowLeft') {
			event.preventDefault();
			step(-1);
		} else if (event.key === ' ' && !(event.target instanceof HTMLButtonElement)) {
			event.preventDefault();
			open = false;
		}
	}

	let startX: number | null = null;

	function onpointerdown(event: PointerEvent): void {
		startX = event.pointerType === 'mouse' ? null : event.clientX;
	}

	function onpointerup(event: PointerEvent): void {
		if (startX === null) return;
		const moved = event.clientX - startX;
		startX = null;
		if (Math.abs(moved) > 48) step(moved < 0 ? 1 : -1);
	}

	const control =
		'flex size-control items-center justify-center rounded-box text-on-shade transition-colors motion hover:bg-shade-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-40 bg-shade" />
		<Dialog.Content
			class="fixed inset-0 z-50 pt-safe pb-safe outline-none"
			aria-label={label}
			{onkeydown}
			{onpointerdown}
			{onpointerup}
		>
			<Dialog.Title class="sr-only">{label}</Dialog.Title>
			<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
			<div
				class="relative flex h-full items-center justify-center px-4 pt-14 pb-16 sm:px-16"
				onclick={(event) => {
					if (event.target === event.currentTarget) open = false;
				}}
			>
				{#if shown !== undefined}
					{#if typeof shown.src !== 'string'}
						<div
							class="flex max-h-full max-w-full items-center justify-center rounded-box bg-shade-2 text-on-shade"
							style="aspect-ratio: {shown.w} / {shown.h}; height: min(100%, {shown.h}px)"
						>
							{#if shown.src === null}
								<Icon name="image-off" label={words.missing} class="size-6" />
							{/if}
						</div>
					{:else}
						<!-- A fresh element per image: a reused one keeps the last image's shape until the next decodes. -->
						{#key shown.src}
							<img
								src={shown.src}
								alt={shown.alt}
								width={shown.w}
								height={shown.h}
								class="max-h-full max-w-full rounded-box object-contain select-none"
								draggable="false"
							/>
						{/key}
					{/if}
				{/if}
				<Dialog.Close class="absolute top-3 right-3 {control}" aria-label={words.close}>
					<Icon name="x" />
				</Dialog.Close>
				{#if many}
					<button
						type="button"
						class="absolute top-1/2 left-3 -translate-y-1/2 max-sm:hidden {control}"
						aria-label={words.previous}
						onclick={() => step(-1)}><Icon name="arrow-left" /></button
					>
					<button
						type="button"
						class="absolute top-1/2 right-3 -translate-y-1/2 max-sm:hidden {control}"
						aria-label={words.next}
						onclick={() => step(1)}><Icon name="arrow-right" /></button
					>
					<p
						class="absolute inset-x-0 bottom-5 text-center text-sm text-on-shade tabular-nums"
						aria-live="polite"
					>
						{words.position(at + 1, items.length)}
					</p>
				{/if}
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
