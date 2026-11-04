<script lang="ts">
	import { tick } from 'svelte';

	import { runToastAction, toast } from '#lib/client/toast.svelte.ts';
	import { keys } from '#lib/ui/keys.ts';
	import { focus } from '#lib/ui/styles.ts';
	import Tooltip from '#lib/ui/Tooltip.svelte';

	let bar: HTMLElement | undefined = $state();

	/** Undo from the keyboard leaves focus on the Redo that replaces it. */
	async function act(event: MouseEvent): Promise<void> {
		const keyboard = (event.currentTarget as HTMLElement).matches(':focus-visible');
		runToastAction();
		if (!keyboard) return;
		await tick();
		bar?.querySelector<HTMLElement>('button')?.focus();
	}
</script>

{#if toast.text}
	{#key toast.seq}
		<div
			bind:this={bar}
			class="pointer-events-none absolute inset-x-gutter bottom-toast z-60 flex enter justify-center"
			role="status"
		>
			<div
				class="pointer-events-auto flex h-control max-w-full items-center gap-3 rounded-panel bg-fill pr-1 pl-3 text-on-fill shadow-float"
			>
				<span class="truncate">{toast.text}</span>
				{#if toast.action !== null}
					<Tooltip
						side="top"
						shortcut={toast.action.label === 'Undo' ? keys('mod', 'z') : keys('mod', 'shift', 'z')}
					>
						{#snippet children(props)}
							<button
								{...props}
								type="button"
								class="h-full shrink-0 rounded-box px-2 font-semibold {focus}"
								onclick={act}>{toast.action?.label}</button
							>
						{/snippet}
					</Tooltip>
				{/if}
			</div>
		</div>
	{/key}
{/if}
