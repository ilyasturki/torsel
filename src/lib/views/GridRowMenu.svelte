<script lang="ts">
	import { grid as words } from '#lib/i18n/grid.ts';
	import Button from '#lib/ui/Button.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import { keys } from '#lib/ui/keys.ts';
	import { wide } from '#lib/ui/media.svelte.ts';
	import Menu from '#lib/ui/Menu.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import MenuSeparator from '#lib/ui/MenuSeparator.svelte';

	let {
		open = $bindable(false),
		anchor,
		rows,
		cells,
		onopen,
		oninsert,
		onduplicate,
		ondelete,
		oncopy,
		onCloseAutoFocus
	}: {
		open?: boolean;
		anchor: HTMLElement | null;
		rows: number;
		cells: number;
		onopen: () => void;
		oninsert: (below: boolean) => void;
		onduplicate: () => void;
		ondelete: () => void;
		oncopy: () => void;
		onCloseAutoFocus?: (event: Event) => void;
	} = $props();

	const remove = $derived(words.deleteRows(rows));
	const copy = $derived(words.copyCells(cells));

	function run(action: () => void): void {
		open = false;
		action();
	}
</script>

{#if wide.current}
	<Menu bind:open {anchor} label={words.row} {onCloseAutoFocus}>
		{#if rows === 1}<MenuItem icon="open" onSelect={onopen}>{words.openRow}</MenuItem>{/if}
		<MenuItem icon="arrow-up" onSelect={() => oninsert(false)}>{words.insertAbove}</MenuItem>
		<MenuItem icon="arrow-down" onSelect={() => oninsert(true)}>{words.insertBelow}</MenuItem>
		<MenuItem icon="plus" onSelect={onduplicate}>{words.duplicateRows(rows)}</MenuItem>
		<MenuItem icon="copy" shortcut={keys('mod', 'c')} onSelect={oncopy}>{copy}</MenuItem>
		<MenuSeparator />
		<MenuItem icon="x" onSelect={ondelete}>{remove}</MenuItem>
	</Menu>
{:else}
	<Dialog bind:open title={words.rows(rows)} {onCloseAutoFocus}>
		<div class="-mx-2 flex flex-col items-stretch">
			<Button variant="ghost" class="justify-start" onclick={() => run(() => oninsert(false))}
				>{words.insertAbove}</Button
			>
			<Button variant="ghost" class="justify-start" onclick={() => run(() => oninsert(true))}
				>{words.insertBelow}</Button
			>
			<Button variant="ghost" class="justify-start" onclick={() => run(onduplicate)}
				>{words.duplicateRows(rows)}</Button
			>
			<Button variant="ghost" class="justify-start" onclick={() => run(oncopy)}>{copy}</Button>
			<Button variant="ghost" class="justify-start" onclick={() => run(ondelete)}>{remove}</Button>
		</div>
	</Dialog>
{/if}
