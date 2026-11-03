<script lang="ts">
	import { swatch } from './colors.ts';
	import Icon from './Icon.svelte';
	import { chip, chipOff, chipOn, input } from './styles.ts';

	type Named = { name: string; color: string | null };

	let {
		options,
		value,
		onchange,
		oncreate,
		label,
		id
	}: {
		options: Named[];
		/** The names picked, in the order they were. */
		value: string[];
		onchange: (value: string[]) => void;
		/** Offers a new name, picked once made; left out, only the options can be picked. */
		oncreate?: (name: string) => void;
		label: string;
		id?: string;
	} = $props();

	// Past this many, a search narrows them rather than a wall of chips.
	const MANY = 12;

	let search = $state('');
	let adding = $state(false);
	let fresh = $state('');

	const shown = $derived.by(() => {
		const needle = search.trim().toLowerCase();
		if (options.length <= MANY || needle === '') return options;
		return options.filter((option) => option.name.toLowerCase().includes(needle));
	});

	function toggle(name: string): void {
		onchange(value.includes(name) ? value.filter((item) => item !== name) : [...value, name]);
	}

	function create(): void {
		const name = fresh.trim();
		adding = false;
		fresh = '';
		if (name === '' || oncreate === undefined) return;
		const known = options.find((option) => option.name.toLowerCase() === name.toLowerCase());
		if (known === undefined) oncreate(name);
		if (!value.includes(known?.name ?? name)) onchange([...value, known?.name ?? name]);
	}
</script>

<div class="flex flex-col gap-2" {id} role="group" aria-label={label}>
	{#if options.length > MANY}
		<input
			class={input}
			bind:value={search}
			placeholder="Search {label}"
			aria-label="Search {label}"
		/>
	{/if}
	<div class="flex flex-wrap gap-1">
		{#each shown as option (option.name)}
			{@const on = value.includes(option.name)}
			<button
				type="button"
				class="{chip} {on ? chipOn : chipOff}"
				aria-pressed={on}
				onclick={() => toggle(option.name)}
			>
				<span class="size-mark rounded-box" style={swatch(option.color)}></span>{option.name}
			</button>
		{/each}
		{#if oncreate !== undefined}
			{#if adding}
				<form
					class="shrink-0"
					onsubmit={(event) => {
						event.preventDefault();
						create();
					}}
				>
					<!-- svelte-ignore a11y_autofocus -->
					<input
						class="{input} w-40"
						bind:value={fresh}
						placeholder="New choice"
						aria-label="New choice"
						autofocus
						onblur={create}
					/>
				</form>
			{:else}
				<button type="button" class="{chip} {chipOff}" onclick={() => (adding = true)}>
					<Icon name="plus" /> New
				</button>
			{/if}
		{/if}
	</div>
</div>
