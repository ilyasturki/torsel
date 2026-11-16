<script lang="ts" module>
	export type ColumnAction =
		| 'rename'
		| 'formula'
		| 'insert-left'
		| 'insert-right'
		| 'hide'
		| 'fit'
		| 'find'
		| 'duplicate'
		| 'settings'
		| 'delete';
</script>

<script lang="ts">
	import type { FieldDef, FieldType } from '#lib/core/model.ts';
	import { common } from '#lib/i18n/common.ts';
	import { grid as words } from '#lib/i18n/grid.ts';
	import Button from '#lib/ui/Button.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import { fieldIcon } from '#lib/ui/field-icons.ts';
	import type { IconName } from '#lib/ui/Icon.svelte';
	import { wide } from '#lib/ui/media.svelte.ts';
	import Menu from '#lib/ui/Menu.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import MenuSeparator from '#lib/ui/MenuSeparator.svelte';
	import MenuSub from '#lib/ui/MenuSub.svelte';
	import { keys } from '#lib/ui/keys.ts';
	import { input } from '#lib/ui/styles.ts';

	import { typeOptions } from './field-types.ts';

	let {
		open = $bindable(false),
		anchor,
		field,
		sorted,
		hidden,
		onshow,
		addable,
		filter,
		onsort,
		onaddsort,
		onfilter,
		retypable = true,
		onretype,
		onaction,
		onCloseAutoFocus
	}: {
		open?: boolean;
		anchor: HTMLElement | null;
		field: FieldDef | undefined;
		sorted: 'asc' | 'desc' | null;
		hidden: FieldDef[];
		onshow: (ids: string[]) => void;
		// The view sorts on other fields, which this one can follow.
		addable: boolean;
		filter: string;
		onsort: (dir: 'asc' | 'desc' | null) => void;
		onaddsort: () => void;
		onfilter: (text: string) => void;
		retypable?: boolean;
		onretype: (type: FieldType) => void;
		onaction: (action: ColumnAction) => void;
		onCloseAutoFocus?: (event: Event) => void;
	} = $props();

	// Link and formula ask for a table or an expression first, in the field sheet.
	const TYPES = typeOptions().map((option) => ({
		...option,
		label: option.value === 'link' || option.value === 'formula' ? `${option.label}…` : option.label
	}));

	type Entry = { action: ColumnAction; label: string; icon: IconName; shortcut?: string } | 'gap';

	const entries = $derived.by((): Entry[] => [
		...(field?.type === 'formula'
			? [{ action: 'formula', label: words.editFormula, icon: 'formula' } as const]
			: []),
		{ action: 'insert-left', label: words.insertLeft, icon: 'arrow-left' },
		{ action: 'insert-right', label: words.insertRight, icon: 'arrow-right' },
		{ action: 'duplicate', label: words.duplicate, icon: 'plus' },
		'gap',
		{ action: 'hide', label: words.hide, icon: 'eye-off' },
		{ action: 'fit', label: words.fitAll, icon: 'fit' },
		{ action: 'find', label: words.findReplace, icon: 'search', shortcut: keys('mod', 'h') },
		{ action: 'settings', label: words.fieldSettings, icon: 'settings' },
		'gap',
		{ action: 'delete', label: common.delete, icon: 'x' }
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
		aria-label={words.filterOf(current.name)}
		placeholder={words.filter}
		value={filter}
		oninput={(event) => onfilter(event.currentTarget.value)}
		onkeydown={onfilterkeydown}
	/>
{/snippet}

{#if field && wide.current}
	<Menu bind:open {anchor} label={field.name} {onCloseAutoFocus}>
		<MenuItem icon="arrow-up" checked={sorted === 'asc'} onSelect={() => onsort('asc')}
			>{words.sortAscending}</MenuItem
		>
		<MenuItem icon="arrow-down" checked={sorted === 'desc'} onSelect={() => onsort('desc')}
			>{words.sortDescending}</MenuItem
		>
		{#if addable}
			<MenuItem icon="plus" onSelect={onaddsort}>{words.addSort}</MenuItem>
		{/if}
		{#if sorted !== null}
			<MenuItem icon="x" onSelect={() => onsort(null)}>{words.clearSort}</MenuItem>
		{/if}
		<div class="p-1">{@render filterInput(field)}</div>
		<MenuSeparator />
		<MenuItem icon="pencil" onSelect={() => onaction('rename')}>{common.rename}</MenuItem>
		{#if retypable}
			<MenuSub label={words.type} icon={fieldIcon(field.type)}>
				{#each TYPES as option, at (option.value)}
					{#if at > 0 && TYPES[at - 1].group !== option.group}<MenuSeparator />{/if}
					<MenuItem
						icon={option.icon}
						checked={option.value === field.type}
						onSelect={() => {
							if (option.value !== field.type) onretype(option.value);
						}}>{option.label}</MenuItem
					>
				{/each}
			</MenuSub>
		{/if}
		{#if hidden.length > 0}
			<MenuSub label={words.hiddenFields(hidden.length)} icon="eye">
				{#each hidden as other (other.id)}
					<MenuItem icon={fieldIcon(other.type)} onSelect={() => onshow([other.id])}
						>{other.name}</MenuItem
					>
				{/each}
				{#if hidden.length > 1}
					<MenuSeparator />
					<MenuItem icon="eye" onSelect={() => onshow(hidden.map((other) => other.id))}
						>{words.showAll}</MenuItem
					>
				{/if}
			</MenuSub>
		{/if}
		{#each entries as entry, index (index)}
			{#if entry === 'gap'}
				<MenuSeparator />
			{:else}
				<MenuItem
					icon={entry.icon}
					shortcut={entry.shortcut}
					onSelect={() => onaction(entry.action)}>{entry.label}</MenuItem
				>
			{/if}
		{/each}
	</Menu>
{:else if field}
	<Dialog bind:open title={field.name} typeOnOpen={false} {onCloseAutoFocus}>
		<div class="-mx-2 flex flex-col items-stretch">
			<Button variant="ghost" class="justify-start" onclick={() => run(() => onsort('asc'))}
				>{words.sortAscending}</Button
			>
			<Button variant="ghost" class="justify-start" onclick={() => run(() => onsort('desc'))}
				>{words.sortDescending}</Button
			>
			{#if addable}
				<Button variant="ghost" class="justify-start" onclick={() => run(onaddsort)}
					>{words.addSort}</Button
				>
			{/if}
			{#if sorted !== null}
				<Button variant="ghost" class="justify-start" onclick={() => run(() => onsort(null))}
					>{words.clearSort}</Button
				>
			{/if}
			<div class="px-2 py-1">{@render filterInput(field)}</div>
			<Button variant="ghost" class="justify-start" onclick={() => run(() => onaction('rename'))}
				>{common.rename}</Button
			>
			{#each hidden as other (other.id)}
				<Button variant="ghost" class="justify-start" onclick={() => run(() => onshow([other.id]))}
					>{words.showField(other.name)}</Button
				>
			{/each}
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
