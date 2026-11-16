<script lang="ts">
	import { Popover } from 'bits-ui';

	import { app } from '#lib/client/app.svelte.ts';
	import { timeFrom } from '#lib/client/format.ts';
	import { refreshing } from '#lib/client/sources.ts';
	import { sourceMark } from '#lib/core/source.ts';
	import { sources as words } from '#lib/i18n/sources.ts';
	import Dialog from '#lib/ui/Dialog.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import Tooltip from '#lib/ui/Tooltip.svelte';
	import { wide } from '#lib/ui/media.svelte.ts';
	import { focus } from '#lib/ui/styles.ts';

	import SourcePanel from './SourcePanel.svelte';

	let { table }: { table: string } = $props();

	let open = $state(false);

	const mark = $derived.by(() => {
		void app.version;
		return sourceMark(app.ws.get(table));
	});

	const running = $derived(refreshing.has(table));
	const problem = $derived(running ? null : (mark?.problem ?? null));

	const tip = $derived.by(() => {
		if (running) return words.refreshing;
		const text =
			problem === null ? undefined : words.problems[problem as keyof typeof words.problems];
		if (typeof text === 'string') return text;
		return mark?.at == null ? words.never : words.refreshed(timeFrom(mark.at));
	});

	const look = $derived(
		`grid size-control shrink-0 place-items-center self-center rounded-box transition-colors motion hover:bg-tint hover:text-ink aria-expanded:bg-tint ${focus} ${problem === null ? 'text-ink-3' : 'text-warn'}`
	);
</script>

{#snippet glyph()}
	<Icon
		name={problem === null ? 'sync' : 'warn'}
		class="size-4 {running ? 'motion-safe:animate-spin' : ''}"
	/>
{/snippet}

{#if mark !== null}
	{#if wide.current}
		<Popover.Root bind:open>
			<Tooltip text={tip} disabled={open}>
				{#snippet children(props)}
					<Popover.Trigger {...props} aria-label={words.source} class={look}>
						{@render glyph()}
					</Popover.Trigger>
				{/snippet}
			</Tooltip>
			<Popover.Portal>
				<Popover.Content
					side="bottom"
					align="start"
					sideOffset={4}
					collisionPadding={8}
					class="z-40 w-96 max-w-full rounded-panel bg-float p-3 shadow-float outline-none"
				>
					<SourcePanel {table} name={mark.name} onstop={() => (open = false)} />
				</Popover.Content>
			</Popover.Portal>
		</Popover.Root>
	{:else}
		<button type="button" aria-label={words.source} class={look} onclick={() => (open = true)}>
			{@render glyph()}
		</button>
		<Dialog bind:open title={mark.name}>
			<SourcePanel {table} onstop={() => (open = false)} />
		</Dialog>
	{/if}
{/if}
