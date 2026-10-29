<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import { Dialog } from 'bits-ui';
	import type { Snippet } from 'svelte';

	let {
		open = $bindable(false),
		title,
		description,
		wide = false,
		children,
		footer
	}: {
		open?: boolean;
		title: string;
		description?: string;
		wide?: boolean;
		children: Snippet;
		footer?: Snippet;
	} = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-40 bg-scrim" />
		<Dialog.Content
			class="fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-3xl bg-surface shadow-2xl outline-none sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:max-h-[85dvh] sm:w-[calc(100%-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl {wide
				? 'sm:max-w-2xl'
				: 'sm:max-w-lg'}"
		>
			<div class="flex items-start gap-3 px-5 pt-5 pb-3">
				<div class="min-w-0 flex-1">
					<Dialog.Title class="text-lg leading-6 font-semibold">{title}</Dialog.Title>
					{#if description}
						<Dialog.Description class="mt-1 text-sm text-ink-muted"
							>{description}</Dialog.Description
						>
					{/if}
				</div>
				<Dialog.Close
					class="-mt-1.5 -mr-2 flex size-10 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-hover"
					aria-label="Fermer"
				>
					<X class="size-5" />
				</Dialog.Close>
			</div>
			<div class="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
				{@render children()}
			</div>
			{#if footer}
				<div
					class="flex gap-2 border-t border-line-soft px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
				>
					{@render footer()}
				</div>
			{/if}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
