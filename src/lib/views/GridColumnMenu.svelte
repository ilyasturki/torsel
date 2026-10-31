<script lang="ts">
	import { Popover } from 'bits-ui';

	import type { FieldDef } from '#lib/core/model.ts';
	import Button from '#lib/ui/Button.svelte';
	import { input } from '#lib/ui/styles.ts';

	let {
		open = $bindable(false),
		anchor,
		field,
		sorted,
		filter,
		onsort,
		onfilter,
		onedit
	}: {
		open?: boolean;
		anchor: HTMLElement | null;
		field: FieldDef | undefined;
		sorted: 'asc' | 'desc' | null;
		filter: string;
		onsort: (dir: 'asc' | 'desc' | null) => void;
		onfilter: (text: string) => void;
		onedit: () => void;
	} = $props();

	function run(action: () => void): void {
		open = false;
		action();
	}
</script>

<Popover.Root bind:open>
	<Popover.Portal>
		{#if field}
			<Popover.Content
				customAnchor={anchor}
				side="bottom"
				align="start"
				sideOffset={2}
				onCloseAutoFocus={(event) => event.preventDefault()}
				class="z-30 flex w-56 flex-col rounded-panel bg-float p-1 shadow-float outline-none"
			>
				<Button
					variant="ghost"
					class="justify-start"
					aria-pressed={sorted === 'asc'}
					onclick={() => run(() => onsort('asc'))}>Sort ascending</Button
				>
				<Button
					variant="ghost"
					class="justify-start"
					aria-pressed={sorted === 'desc'}
					onclick={() => run(() => onsort('desc'))}>Sort descending</Button
				>
				{#if sorted !== null}
					<Button variant="ghost" class="justify-start" onclick={() => run(() => onsort(null))}
						>Clear sort</Button
					>
				{/if}
				<div class="p-1">
					<input
						class={input}
						aria-label="Filter {field.name}"
						placeholder="Filter"
						value={filter}
						oninput={(event) => onfilter(event.currentTarget.value)}
						onkeydown={(event) => {
							if (event.key === 'Enter') {
								event.preventDefault();
								open = false;
							}
						}}
					/>
				</div>
				<Button variant="ghost" class="justify-start" onclick={() => run(onedit)}
					>Field settings</Button
				>
			</Popover.Content>
		{/if}
	</Popover.Portal>
</Popover.Root>
