<script lang="ts">
	import { Popover } from 'bits-ui';

	import Calendar from './Calendar.svelte';

	let {
		anchor,
		value,
		onpick,
		onoutside
	}: {
		/** The field the date is typed in: it keeps the focus while the month is clicked. */
		anchor: HTMLElement;
		value: string | null;
		onpick: (day: string) => void;
		onoutside?: (target: EventTarget | null) => void;
	} = $props();
</script>

<Popover.Root open={true}>
	<Popover.Portal>
		<Popover.Content
			customAnchor={anchor}
			side="bottom"
			align="start"
			sideOffset={4}
			collisionPadding={8}
			trapFocus={false}
			onOpenAutoFocus={(event) => event.preventDefault()}
			onCloseAutoFocus={(event) => event.preventDefault()}
			onInteractOutside={(event) => {
				event.preventDefault();
				if (!anchor.contains(event.target as Node)) onoutside?.(event.target);
			}}
			onEscapeKeydown={(event) => event.preventDefault()}
			class="z-50 w-72 rounded-panel bg-float p-2 shadow-float outline-none"
			onmousedown={(event) => event.preventDefault()}
		>
			<Calendar {value} {onpick} />
		</Popover.Content>
	</Popover.Portal>
</Popover.Root>
