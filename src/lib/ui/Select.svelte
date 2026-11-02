<script lang="ts" module>
	import type { IconName } from './Icon.svelte';

	export type Option<T extends string = string> = {
		value: T;
		label: string;
		icon?: IconName;
		/** A data colour, drawn as the choice's swatch. */
		color?: string | null;
	};
</script>

<script lang="ts" generics="T extends string">
	import { Combobox } from 'bits-ui';

	import { swatch } from './colors.ts';
	import Icon from './Icon.svelte';
	import { input, menuItem, popup } from './styles.ts';

	let {
		value = $bindable(),
		options,
		onchange,
		placeholder,
		disabled = false,
		id,
		'aria-label': ariaLabel,
		class: extra = ''
	}: {
		value?: T;
		options: Option<T>[];
		onchange?: (value: T) => void;
		placeholder?: string;
		disabled?: boolean;
		id?: string;
		'aria-label'?: string;
		class?: string;
	} = $props();

	const SEARCH_PAST = 7;

	let open = $state(false);
	let query = $state<string | null>(null);
	let field: HTMLInputElement | null = $state(null);

	// bits-ui reads "" as nothing picked, and "" is a value here ("None", "Automatic").
	const key = (option: T): string => `=${option}`;

	const searchable = $derived(options.length > SEARCH_PAST);
	const selected = $derived(options.find((option) => option.value === value));
	const shown = $derived.by(() => {
		const needle = query?.trim().toLocaleLowerCase() ?? '';
		return needle === ''
			? options
			: options.filter((option) => option.label.toLocaleLowerCase().includes(needle));
	});
	const items = $derived(
		options.map((option) => ({ value: key(option.value), label: option.label }))
	);

	$effect(() => {
		if (!open) query = null;
	});

	function pick(next: string): void {
		const option = options.find((item) => key(item.value) === next);
		if (option === undefined) return;
		value = option.value;
		onchange?.(option.value);
	}
</script>

<Combobox.Root
	type="single"
	bind:open
	value={selected === undefined ? '' : key(selected.value)}
	onValueChange={pick}
	inputValue={query ?? selected?.label ?? ''}
	allowDeselect={false}
	{disabled}
	{items}
>
	<span class="relative block min-w-0 {extra}">
		{#if selected?.icon}
			<Icon
				name={selected.icon}
				class="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-ink-2"
			/>
		{:else if selected?.color !== undefined}
			<span
				class="pointer-events-none absolute top-1/2 left-2.5 size-mark -translate-y-1/2 rounded-box"
				style={swatch(selected.color)}
			></span>
		{/if}
		<Combobox.Input
			bind:ref={field}
			{id}
			aria-label={ariaLabel}
			{placeholder}
			readonly={!searchable}
			autocomplete="off"
			spellcheck="false"
			class="{input} pr-7 text-left disabled:text-ink-3 {searchable
				? ''
				: 'cursor-default'} {selected?.icon !== undefined || selected?.color !== undefined
				? 'pl-8'
				: ''}"
			onclick={() => {
				if (!disabled) open = searchable || !open;
			}}
			onfocus={() => {
				if (searchable) field?.select();
			}}
			oninput={(event) => (query = event.currentTarget.value)}
		/>
		<Icon
			name="chevron"
			class="pointer-events-none absolute top-1/2 right-2 size-3 -translate-y-1/2 rotate-90 text-ink-3"
		/>
	</span>
	<Combobox.Portal>
		<Combobox.Content
			sideOffset={4}
			collisionPadding={8}
			class="{popup} flex max-h-(--bits-combobox-content-available-height) w-(--bits-combobox-anchor-width) min-w-48 flex-col"
		>
			<Combobox.Viewport class="max-h-80">
				{#each shown as option (option.value)}
					<Combobox.Item value={key(option.value)} label={option.label} class={menuItem}>
						{#snippet children({ selected: picked })}
							{#if option.icon}
								<Icon name={option.icon} class="size-4 text-ink-2" />
							{:else if option.color !== undefined}
								<span class="size-mark shrink-0 rounded-box" style={swatch(option.color)}></span>
							{/if}
							<span class="min-w-0 flex-1 truncate">{option.label || ' '}</span>
							{#if picked}<Icon name="check" class="size-4 text-ink-2" />{/if}
						{/snippet}
					</Combobox.Item>
				{:else}
					<p class="flex h-control items-center px-2 text-ink-3">No match</p>
				{/each}
			</Combobox.Viewport>
		</Combobox.Content>
	</Combobox.Portal>
</Combobox.Root>
