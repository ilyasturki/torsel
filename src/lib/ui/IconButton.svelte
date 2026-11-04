<script lang="ts">
	import { mergeProps } from 'bits-ui';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	import Icon, { type IconName } from './Icon.svelte';
	import { focus } from './styles.ts';
	import Tooltip from './Tooltip.svelte';

	let {
		icon,
		label,
		variant = 'ghost',
		tooltip = true,
		shortcut,
		pressed,
		class: extra = '',
		...rest
	}: Omit<HTMLButtonAttributes, 'aria-label' | 'aria-pressed'> & {
		icon: IconName;
		label: string;
		variant?: 'ghost' | 'secondary' | 'primary';
		tooltip?: boolean;
		shortcut?: string;
		pressed?: boolean;
	} = $props();

	const variants = {
		primary: 'bg-fill text-on-fill hover:opacity-90 disabled:bg-tint-2 disabled:text-ink-3',
		secondary: 'bg-tint text-ink hover:bg-tint-2 disabled:text-ink-3',
		ghost:
			'text-ink-2 hover:bg-tint hover:text-ink disabled:text-ink-3 aria-pressed:bg-tint-2 aria-pressed:text-ink'
	};

	const own = $derived({
		type: 'button' as const,
		'aria-label': label,
		'aria-pressed': pressed,
		class: `inline-flex size-control shrink-0 items-center justify-center rounded-box transition-colors motion disabled:pointer-events-none ${focus} ${variants[variant]} ${extra}`
	});
</script>

{#if tooltip}
	<Tooltip text={label} {shortcut}>
		{#snippet children(props)}
			<button {...mergeProps(props, rest, own)}><Icon name={icon} /></button>
		{/snippet}
	</Tooltip>
{:else}
	<button {...mergeProps(rest, own)}><Icon name={icon} /></button>
{/if}
