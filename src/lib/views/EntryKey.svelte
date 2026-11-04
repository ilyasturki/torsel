<script lang="ts">
	import { app } from '#lib/client/app.svelte.ts';
	import { applyWithUndo } from '#lib/client/toast.svelte.ts';
	import { updateRecord } from '#lib/core/actions.ts';
	import type { FieldDef, Value } from '#lib/core/model.ts';
	import { nextChoice, swatch } from '#lib/ui/colors.ts';
	import Icon from '#lib/ui/Icon.svelte';
	import Select from '#lib/ui/Select.svelte';
	import { chip, chipOff, chipOn, input } from '#lib/ui/styles.ts';

	let {
		field,
		value,
		recent,
		onpick
	}: {
		field: FieldDef;
		value: Value;
		recent: string[];
		onpick: (value: Value) => void;
	} = $props();

	const MANY = 12;

	let search = $state('');
	let adding = $state(false);
	let fresh = $state('');

	const choices = $derived.by(() => {
		if (field.choices.length <= MANY) return field.choices;
		const needle = search.trim().toLowerCase();
		if (needle !== '') {
			return field.choices.filter((choice) => choice.name.toLowerCase().includes(needle));
		}
		const byName = new Map(field.choices.map((choice) => [choice.name, choice]));
		const names =
			typeof value === 'string' && !recent.includes(value) ? [value, ...recent] : recent;
		return names.map((name) => byName.get(name) ?? { name, color: null });
	});

	const targets = $derived.by(() => {
		void app.version;
		return field.target === null
			? []
			: app.ws
					.rows(field.target)
					.map((row) => ({ value: row.id, label: app.ws.rowTitle(row.id) || row.id }));
	});

	function add(): void {
		const name = fresh.trim();
		adding = false;
		fresh = '';
		if (name === '') return;
		if (!field.choices.some((choice) => choice.name === name)) {
			applyWithUndo(
				updateRecord(app.ws, field.id, {
					choices: [...field.choices, nextChoice(field.choices, name)]
				}),
				`Choice "${name}" added`
			);
		}
		onpick(name);
	}

	function reveal(node: HTMLElement, on: boolean): { update(on: boolean): void } {
		const show = (now: boolean): void => {
			if (now) node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
		};
		show(on);
		return { update: show };
	}
</script>

<div class="flex min-w-0 flex-col gap-1.5">
	<span class="text-sm font-medium text-ink-2">{field.name}</span>
	{#if field.type === 'choice'}
		{#if field.choices.length > MANY}
			<input
				class={input}
				bind:value={search}
				placeholder="Search {field.name}"
				aria-label="Search {field.name}"
			/>
		{/if}
		<div
			class="flex hide-scrollbar gap-1 max-lg:-mx-4 max-lg:overflow-x-auto max-lg:px-4 lg:flex-wrap"
		>
			{#each choices as choice (choice.name)}
				{@const on = value === choice.name}
				<button
					type="button"
					class="{chip} {on ? chipOn : chipOff}"
					aria-pressed={on}
					use:reveal={on}
					onclick={() => onpick(on ? null : choice.name)}
				>
					<span class="size-mark rounded-box" style={swatch(choice.color)}></span>{choice.name}
				</button>
			{/each}
			{#if adding}
				<form
					class="shrink-0"
					onsubmit={(event) => {
						event.preventDefault();
						add();
					}}
				>
					<!-- svelte-ignore a11y_autofocus -->
					<input
						class="{input} w-40"
						bind:value={fresh}
						placeholder="New choice"
						aria-label="New choice"
						autofocus
						onblur={add}
					/>
				</form>
			{:else}
				<button type="button" class="{chip} {chipOff}" onclick={() => (adding = true)}>
					<Icon name="plus" /> New
				</button>
			{/if}
		</div>
	{:else if field.type === 'link'}
		<Select
			aria-label={field.name}
			placeholder={field.name}
			options={[{ value: '', label: '' }, ...targets]}
			value={typeof value === 'string' ? value : ''}
			onchange={(picked) => onpick(picked || null)}
		/>
	{:else}
		<input
			class={input}
			aria-label={field.name}
			placeholder={field.name}
			value={value ?? ''}
			oninput={(event) => onpick(event.currentTarget.value || null)}
		/>
	{/if}
</div>
