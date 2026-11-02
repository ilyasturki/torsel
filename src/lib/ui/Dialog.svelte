<script lang="ts">
	import { Dialog } from 'bits-ui';
	import type { Snippet } from 'svelte';

	import Button from './Button.svelte';
	import IconButton from './IconButton.svelte';

	let {
		open = $bindable(false),
		title,
		description,
		dirty = false,
		typeOnOpen = true,
		onsubmit,
		onCloseAutoFocus,
		children,
		footer
	}: {
		open?: boolean;
		title: string;
		description?: string;
		dirty?: boolean;
		/** False keeps a touch keyboard down on open, for a sheet whose first field is optional. */
		typeOnOpen?: boolean;
		onsubmit?: () => void;
		/** Called as the sheet hands focus back to what opened it; preventing it keeps focus where an action put it. */
		onCloseAutoFocus?: (event: Event) => void;
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
		if (!typeOnOpen && matchMedia('(pointer: coarse)').matches) {
			body?.closest<HTMLElement>('[role=dialog]')?.focus();
			return;
		}
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
			class="fixed inset-x-0 bottom-0 z-50 flex max-h-sheet-max enter flex-col rounded-panel bg-float pb-safe shadow-float outline-none sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-sheet sm:-translate-x-1/2 sm:-translate-y-1/2 sm:pb-0"
			onOpenAutoFocus={focusFirstControl}
			{onCloseAutoFocus}
			onEscapeKeydown={guard}
			onInteractOutside={guard}
			{onkeydown}
		>
			<div class="flex shrink-0 items-center gap-3 p-4 pb-2">
				<Dialog.Title class="min-w-0 flex-1 truncate text-lg font-semibold tight"
					>{title}</Dialog.Title
				>
				<IconButton icon="x" label="Close" tooltip={false} onclick={close} />
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
