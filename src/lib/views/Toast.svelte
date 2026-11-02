<script lang="ts">
	import { runToastAction, toast } from '#lib/client/toast.svelte.ts';
</script>

{#if toast.text}
	{#key toast.seq}
		<div
			class="pointer-events-none absolute inset-x-gutter bottom-toast z-30 flex enter justify-center"
			role="status"
		>
			<div
				class="pointer-events-auto flex h-control max-w-full items-center gap-3 rounded-panel bg-fill pr-1 pl-3 text-on-fill shadow-float"
			>
				<span class="truncate">{toast.text}</span>
				{#if toast.action !== null}
					<button type="button" class="h-full shrink-0 px-2 font-semibold" onclick={runToastAction}
						>{toast.action.label}</button
					>
				{/if}
			</div>
		</div>
	{/key}
{/if}
