<script lang="ts">
	import { Dialog } from 'bits-ui';
	import type { Snippet } from 'svelte';

	let {
		open = $bindable(false),
		title,
		onclose,
		onCloseAutoFocus,
		children
	}: {
		open?: boolean;
		title: string;
		/** A swipe, the backdrop or Escape closed it; not called when the owner sets `open` itself. */
		onclose?: () => void;
		onCloseAutoFocus?: (event: Event) => void;
		children: Snippet;
	} = $props();

	// Past this far down, or this fast in px/ms, a released drag closes the drawer.
	const CLOSE_AT = 96;
	const FLING = 0.5;

	let sheet = $state<HTMLElement | null>(null);
	let drag = $state(0);
	let dragging = $state(false);
	let leaving = $state(false);
	let start = { y: 0, at: 0 };

	$effect(() => {
		if (open) {
			drag = 0;
			leaving = false;
		}
	});

	function dismiss(): void {
		if (leaving) return;
		leaving = true;
		const ms = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--slow'));
		setTimeout(
			() => {
				open = false;
				onclose?.();
			},
			Number.isFinite(ms) ? ms : 0
		);
	}

	function ondown(event: PointerEvent): void {
		if (event.button !== 0) return;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		start = { y: event.clientY, at: event.timeStamp };
		dragging = true;
	}

	function onmove(event: PointerEvent): void {
		if (dragging) drag = Math.max(0, event.clientY - start.y);
	}

	function onup(event: PointerEvent): void {
		if (!dragging) return;
		dragging = false;
		const speed = drag / Math.max(1, event.timeStamp - start.at);
		if (drag > CLOSE_AT || (drag > 8 && speed > FLING)) dismiss();
		else drag = 0;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay
			class="fixed inset-0 z-50 bg-scrim transition-opacity motion {leaving ? 'opacity-0' : ''}"
		/>
		<Dialog.Content
			bind:ref={sheet}
			class="fixed inset-x-0 bottom-0 z-50 flex max-h-sheet-max rise flex-col rounded-panel bg-float pb-safe shadow-float outline-none {dragging
				? ''
				: 'transition-[translate] motion-slow'}"
			style="translate: 0 {leaving ? '100%' : `${drag}px`}"
			onOpenAutoFocus={(event) => {
				event.preventDefault();
				sheet?.focus();
			}}
			{onCloseAutoFocus}
			onEscapeKeydown={(event) => {
				event.preventDefault();
				dismiss();
			}}
			onInteractOutside={(event) => {
				event.preventDefault();
				if (!(event.target instanceof Element && event.target.closest('[role="status"]'))) {
					dismiss();
				}
			}}
		>
			<div
				class="flex shrink-0 cursor-grab touch-none flex-col items-center gap-2 px-4 pt-2 pb-3 select-none"
				role="presentation"
				data-drawer-handle
				onpointerdown={ondown}
				onpointermove={onmove}
				onpointerup={onup}
				onpointercancel={onup}
			>
				<span class="h-1 w-10 rounded-box bg-edge" aria-hidden="true"></span>
				<Dialog.Title class="w-full truncate text-lg font-semibold tight">{title}</Dialog.Title>
			</div>
			<div class="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
				{@render children()}
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
