<script lang="ts">
	import { Popover } from 'bits-ui';

	import type { ViewDef } from '#lib/core/model.ts';
	import { rules as words } from '#lib/i18n/rules.ts';
	import Icon from '#lib/ui/Icon.svelte';
	import { focus } from '#lib/ui/styles.ts';
	import Tooltip from '#lib/ui/Tooltip.svelte';

	import RulesEditor from './RulesEditor.svelte';

	let { view, kind }: { view: ViewDef; kind: 'filter' | 'colors' } = $props();

	let open = $state(false);
	let panel = $state<HTMLElement | null>(null);

	const label = $derived(kind === 'filter' ? words.filter : words.colors);
	const count = $derived(
		kind === 'filter' ? (view.config.filters ?? []).length : (view.config.colors ?? []).length
	);
</script>

<Popover.Root bind:open>
	<Tooltip text={label} disabled={open}>
		{#snippet children(props)}
			<Popover.Trigger
				{...props}
				aria-label={count > 0 ? `${label} (${count})` : label}
				data-rules={kind}
				class="inline-flex h-control min-w-control shrink-0 items-center justify-center gap-1 rounded-box px-2 text-ink-2 transition-colors motion hover:bg-tint hover:text-ink aria-expanded:bg-tint-2 aria-expanded:text-ink {count >
				0
					? 'bg-tint-2 text-ink'
					: ''} {focus}"
			>
				<Icon name={kind === 'filter' ? 'filter' : 'color'} />
				{#if count > 0}<span class="text-sm font-medium tabular-nums">{count}</span>{/if}
			</Popover.Trigger>
		{/snippet}
	</Tooltip>
	<Popover.Portal>
		<Popover.Content
			side="bottom"
			align="end"
			sideOffset={4}
			collisionPadding={8}
			bind:ref={panel}
			role="dialog"
			aria-label={label}
			tabindex={-1}
			onOpenAutoFocus={(event) => {
				// Its first field would open selected; the panel takes focus and Tab walks in.
				event.preventDefault();
				panel?.focus();
			}}
			class="z-40 flex w-xl max-w-full flex-col gap-2 rounded-panel bg-float p-3 shadow-float outline-none"
		>
			<span class="text-sm font-medium text-ink-2">{label}</span>
			<RulesEditor viewId={view.id} {kind} />
		</Popover.Content>
	</Popover.Portal>
</Popover.Root>
