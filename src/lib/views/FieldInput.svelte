<script lang="ts">
	import { app } from '#lib/client/app.svelte.ts';
	import { formatValue } from '#lib/client/format.ts';
	import { updateRecord } from '#lib/core/actions.ts';
	import type { FieldDef, Value } from '#lib/core/model.ts';
	import { isContact, isNumeric } from '#lib/core/model.ts';
	import { nativeDateText, parseDate, ratingScale } from '#lib/core/values.ts';
	import { fields as words } from '#lib/i18n/fields.ts';
	import ChipPicker from '#lib/ui/ChipPicker.svelte';
	import { nextChoice } from '#lib/ui/colors.ts';
	import Rating from '#lib/ui/Rating.svelte';
	import Select from '#lib/ui/Select.svelte';
	import { checkbox, input } from '#lib/ui/styles.ts';
	import Textarea from '#lib/ui/Textarea.svelte';

	import AmountInput from './AmountInput.svelte';
	import ContactInput from './ContactInput.svelte';

	let {
		field,
		value = $bindable(),
		computed = null,
		id
	}: { field: FieldDef; value?: Value; computed?: Value; id?: string } = $props();

	const targets = $derived.by(() => {
		void app.version;
		if (field.type !== 'link' || field.target === null) {
			return [];
		}
		return app.ws
			.rows(field.target)
			.map((row) => ({ id: row.id, title: app.ws.rowTitle(row.id) || row.id }))
			.sort((a, b) => a.title.localeCompare(b.title));
	});

	function addChoice(name: string): void {
		app.apply(
			updateRecord(app.ws, field.id, {
				choices: [...field.choices, nextChoice(field.choices, name)]
			}),
			words.choiceAdded(name)
		);
	}
</script>

{#if field.type === 'rating'}
	<Rating
		{id}
		label={field.name}
		{...ratingScale(field)}
		value={typeof value === 'number' ? value : null}
		onchange={(next) => (value = next)}
	/>
{:else if isNumeric(field.type)}
	<AmountInput
		{id}
		{field}
		bind:value
		placeholder={field.type === 'duration' ? undefined : field.name}
	/>
{:else if field.type === 'date' || field.type === 'datetime'}
	<input
		{id}
		class={input}
		type={field.type === 'datetime' ? 'datetime-local' : 'date'}
		value={nativeDateText(field, value)}
		oninput={(event) => (value = parseDate(event.currentTarget.value))}
	/>
{:else if field.type === 'choice'}
	<Select
		{id}
		options={[
			{ value: '', label: '' },
			...field.choices.map((choice) => ({
				value: choice.name,
				label: choice.name,
				color: choice.color ?? null
			}))
		]}
		value={typeof value === 'string' ? value : ''}
		placeholder={field.name}
		onchange={(picked) => (value = picked || null)}
	/>
{:else if field.type === 'choices'}
	<ChipPicker
		{id}
		label={field.name}
		options={field.choices}
		value={Array.isArray(value) ? value.filter((name) => typeof name === 'string') : []}
		onchange={(names) => (value = names.length === 0 ? null : names)}
		oncreate={addChoice}
	/>
{:else if field.type === 'check'}
	<input
		{id}
		type="checkbox"
		class={checkbox}
		checked={value === true}
		onchange={() => (value = value !== true)}
	/>
{:else if field.type === 'link'}
	<Select
		{id}
		options={[
			{ value: '', label: '' },
			...targets.map((target) => ({ value: target.id, label: target.title }))
		]}
		value={typeof value === 'string' ? value : ''}
		placeholder={field.name}
		onchange={(picked) => (value = picked || null)}
	/>
{:else if field.type === 'formula'}
	<p class="flex h-control items-center px-2 text-ink-2">
		{formatValue(field, computed ?? null)}
	</p>
{:else if field.type === 'longtext'}
	<Textarea
		{id}
		rows={3}
		maxRows={12}
		placeholder={field.name}
		value={typeof value === 'string' ? value : ''}
		oninput={(event) =>
			(value = event.currentTarget.value === '' ? null : event.currentTarget.value)}
	/>
{:else if isContact(field.type)}
	<ContactInput
		{id}
		field={{ ...field, type: field.type as 'url' | 'email' | 'phone' }}
		bind:value
		placeholder={field.name}
	/>
{:else}
	<input
		{id}
		class={input}
		placeholder={field.name}
		value={typeof value === 'string' ? value : ''}
		oninput={(event) =>
			(value = event.currentTarget.value === '' ? null : event.currentTarget.value)}
	/>
{/if}
