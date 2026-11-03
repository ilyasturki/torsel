<script lang="ts" module>
	export type ColumnAction =
		'rename' | 'formula' | 'insert-left' | 'insert-right' | 'hide' | 'fit' | 'settings' | 'delete';
</script>

<script lang="ts">
	import type { FieldDef, FieldType } from '#lib/core/model.ts';
	import Button from '#lib/ui/Button.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import { fieldIcon } from '#lib/ui/field-icons.ts';
	import type { IconName } from '#lib/ui/Icon.svelte';
	import { wide } from '#lib/ui/media.svelte.ts';
	import Menu from '#lib/ui/Menu.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import MenuSeparator from '#lib/ui/MenuSeparator.svelte';
	import MenuSub from '#lib/ui/MenuSub.svelte';
	import { input } from '#lib/ui/styles.ts';

	let {
		open = $bindable(false),
		anchor,
		field,
		sorted,
		filter,
		onsort,
		onfilter,
		onretype,
		onaction,
		onCloseAutoFocus
	}: {
		open?: boolean;
		anchor: HTMLElement | null;
		field: FieldDef | undefined;
		sorted: 'asc' | 'desc' | null;
		filter: string;
		onsort: (dir: 'asc' | 'desc' | null) => void;
		onfilter: (text: string) => void;
		onretype: (type: FieldType) => void;
		onaction: (action: ColumnAction) => void;
		onCloseAutoFocus?: (event: Event) => void;
	} = $props();

	const TYPES = (
		[
			['text', 'Text'],
			['number', 'Number'],
			['date', 'Date'],
			['choice', 'Choice'],
			['check', 'Checkbox'],
			['link', 'Link to a table…'],
			['formula', 'Formula…']
		] as const
	).map(([type, label]) => ({ type: type as FieldType, label, icon: fieldIcon(type) }));

	type Entry = { action: ColumnAction; label: string; icon: IconName } | 'gap';

	const entries = $derived.by((): Entry[] => [
		...(field?.type === 'formula'
			? [{ action: 'formula', label: 'Edit formula', icon: 'formula' } as const]
			: []),
		{ action: 'insert-left', label: 'Insert left', icon: 'arrow-left' },
		{ action: 'insert-right', label: 'Insert right', icon: 'arrow-right' },
		'gap',
		{ action: 'hide', label: 'Hide', icon: 'eye-off' },
		{ action: 'fit', label: 'Fit all columns', icon: 'fit' },
		{ action: 'settings', label: 'Field settings', icon: 'settings' },
		'gap',
		{ action: 'delete', label: 'Delete', icon: 'x' }
	]);

	function run(action: () => void): void {
		open = false;
		action();
	}

	function onfilterkeydown(event: KeyboardEvent): void {
		if (event.key === 'Enter') {
			event.preventDefault();
			open = false;
		}
		// The menu would read the letters as a search of its items and move focus there.
		if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation();
	}
</script>

{#snippet filterInput(current: FieldDef)}
	<input
		class={input}
		aria-label="Filter {current.name}"
		placeholder="Filter"
		value={filter}
		oninput={(event) => onfilter(event.currentTarget.value)}
		onkeydown={onfilterkeydown}
	/>
{/snippet}

{#if field && wide.current}
	<Menu bind:open {anchor} label={field.name} {onCloseAutoFocus}>
		<MenuItem icon="arrow-up" checked={sorted === 'asc'} onSelect={() => onsort('asc')}
			>Sort ascending</MenuItem
		>
		<MenuItem icon="arrow-down" checked={sorted === 'desc'} onSelect={() => onsort('desc')}
			>Sort descending</MenuItem
		>
		{#if sorted !== null}
			<MenuItem icon="x" onSelect={() => onsort(null)}>Clear sort</MenuItem>
		{/if}
		<div class="p-1">{@render filterInput(field)}</div>
		<MenuSeparator />
		<MenuItem icon="pencil" onSelect={() => onaction('rename')}>Rename</MenuItem>
		<MenuSub label="Type" icon={fieldIcon(field.type)}>
			{#each TYPES as option (option.type)}
				<MenuItem
					icon={option.icon}
					checked={option.type === field.type}
					onSelect={() => {
						if (option.type !== field.type) onretype(option.type);
					}}>{option.label}</MenuItem
				>
			{/each}
		</MenuSub>
		{#each entries as entry, index (index)}
			{#if entry === 'gap'}
				<MenuSeparator />
			{:else}
				<MenuItem icon={entry.icon} onSelect={() => onaction(entry.action)}>{entry.label}</MenuItem>
			{/if}
		{/each}
	</Menu>
{:else if field}
	<Dialog bind:open title={field.name} typeOnOpen={false} {onCloseAutoFocus}>
		<div class="-mx-2 flex flex-col items-stretch">
			<Button variant="ghost" class="justify-start" onclick={() => run(() => onsort('asc'))}
				>Sort ascending</Button
			>
			<Button variant="ghost" class="justify-start" onclick={() => run(() => onsort('desc'))}
				>Sort descending</Button
			>
			{#if sorted !== null}
				<Button variant="ghost" class="justify-start" onclick={() => run(() => onsort(null))}
					>Clear sort</Button
				>
			{/if}
			<div class="px-2 py-1">{@render filterInput(field)}</div>
			<Button variant="ghost" class="justify-start" onclick={() => run(() => onaction('rename'))}
				>Rename</Button
			>
			{#each entries as entry, index (index)}
				{#if entry !== 'gap'}
					<Button
						variant="ghost"
						class="justify-start"
						onclick={() => run(() => onaction(entry.action))}>{entry.label}</Button
					>
				{/if}
			{/each}
		</div>
	</Dialog>
{/if}
