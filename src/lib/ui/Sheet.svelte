<script lang="ts">
	import { Dialog } from 'bits-ui';
	import type { Snippet } from 'svelte';

	import Button from './Button.svelte';
	import Icon from './Icon.svelte';

	let {
		open = $bindable(false),
		title,
		description,
		dirty = false,
		onsubmit,
		children,
		footer
	}: {
		open?: boolean;
		title: string;
		description?: string;
		dirty?: boolean;
		onsubmit?: () => void;
		children: Snippet;
		footer?: Snippet;
	} = $props();

	let body: HTMLElement | undefined = $state();
	let confirming = $state(false);

	$effect(() => {
		if (open) confirming = false;
	});

	function focusFirstControl(event: Event): void {
		event.preventDefault();
		body
			?.querySelector<HTMLElement>('[data-autofocus], input:not([type="file"]), select, textarea')
			?.focus();
	}

	function guard(event: Event): void {
		if (dirty) {
			event.preventDefault();
			confirming = true;
		}
	}

	function close(): void {
		if (dirty) {
			confirming = true;
		} else {
			open = false;
		}
	}

	function onkeydown(event: KeyboardEvent): void {
		if (
			onsubmit === undefined ||
			confirming ||
			event.key !== 'Enter' ||
			event.isComposing ||
			event.defaultPrevented
		) {
			return;
		}

		const target = event.target as HTMLElement;
		const submits =
			target === event.currentTarget ||
			target.tagName === 'SELECT' ||
			(target instanceof HTMLInputElement && target.type !== 'file') ||
			(target.tagName === 'TEXTAREA' && (event.ctrlKey || event.metaKey));

		if (submits) {
			event.preventDefault();
			onsubmit();
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-40 bg-scrim" />
		<Dialog.Content
			class="fixed inset-x-0 bottom-0 z-50 flex max-h-sheet-max flex-col rounded-panel bg-float pb-safe shadow-float outline-none sm:inset-x-auto sm:top-4 sm:right-4 sm:bottom-4 sm:max-h-none sm:w-sheet"
			onOpenAutoFocus={focusFirstControl}
			onEscapeKeydown={guard}
			onInteractOutside={guard}
			{onkeydown}
		>
			<div class="flex shrink-0 items-center gap-3 p-4 pb-2">
				<Dialog.Title class="min-w-0 flex-1 truncate text-lg font-semibold tight"
					>{title}</Dialog.Title
				>
				<button
					type="button"
					class="flex size-control shrink-0 items-center justify-center rounded-box text-ink-2 transition-colors motion hover:bg-tint hover:text-ink"
					aria-label="Close"
					onclick={close}
				>
					<Icon name="x" />
				</button>
			</div>
			<div bind:this={body} class="min-h-0 flex-1 overflow-y-auto p-4 pt-2">
				{#if description}
					<Dialog.Description class="mb-3 text-ink-2">{description}</Dialog.Description>
				{/if}
				{@render children()}
			</div>
			{#if confirming}
				<div
					class="flex shrink-0 items-center gap-2 p-4 pt-2"
					role="alertdialog"
					aria-label="Discard changes"
				>
					<span class="min-w-0 flex-1 font-medium">Discard your changes?</span>
					<Button onclick={() => (confirming = false)}>Keep editing</Button>
					<Button variant="primary" onclick={() => (open = false)}>Discard</Button>
				</div>
			{:else if footer}
				<div class="flex shrink-0 gap-2 p-4 pt-2">
					{@render footer()}
				</div>
			{/if}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
