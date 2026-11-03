<script lang="ts">
	import Button from '#lib/ui/Button.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import { wide } from '#lib/ui/media.svelte.ts';
	import Menu from '#lib/ui/Menu.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import MenuSeparator from '#lib/ui/MenuSeparator.svelte';

	let {
		open = $bindable(false),
		anchor,
		rows,
		cells,
		oninsert,
		ondelete,
		oncopy,
		onCloseAutoFocus
	}: {
		open?: boolean;
		anchor: HTMLElement | null;
		rows: number;
		cells: number;
		oninsert: (below: boolean) => void;
		ondelete: () => void;
		oncopy: () => void;
		onCloseAutoFocus?: (event: Event) => void;
	} = $props();

	const mac = typeof navigator !== 'undefined' && /Mac|iP/u.test(navigator.platform);
	const remove = $derived(rows === 1 ? 'Delete row' : `Delete ${rows} rows`);
	const copy = $derived(cells === 1 ? 'Copy' : `Copy ${cells} cells`);

	function run(action: () => void): void {
		open = false;
		action();
	}
</script>

{#if wide.current}
	<Menu bind:open {anchor} label="Row" {onCloseAutoFocus}>
		<MenuItem icon="arrow-up" onSelect={() => oninsert(false)}>Insert row above</MenuItem>
		<MenuItem icon="arrow-down" onSelect={() => oninsert(true)}>Insert row below</MenuItem>
		<MenuItem icon="copy" shortcut={mac ? '⌘C' : 'Ctrl+C'} onSelect={oncopy}>{copy}</MenuItem>
		<MenuSeparator />
		<MenuItem icon="x" onSelect={ondelete}>{remove}</MenuItem>
	</Menu>
{:else}
	<Dialog bind:open title={rows === 1 ? 'Row' : `${rows} rows`} {onCloseAutoFocus}>
		<div class="-mx-2 flex flex-col items-stretch">
			<Button variant="ghost" class="justify-start" onclick={() => run(() => oninsert(false))}
				>Insert row above</Button
			>
			<Button variant="ghost" class="justify-start" onclick={() => run(() => oninsert(true))}
				>Insert row below</Button
			>
			<Button variant="ghost" class="justify-start" onclick={() => run(oncopy)}>{copy}</Button>
			<Button variant="ghost" class="justify-start" onclick={() => run(ondelete)}>{remove}</Button>
		</div>
	</Dialog>
{/if}
