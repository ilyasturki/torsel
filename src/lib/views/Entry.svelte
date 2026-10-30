<script lang="ts">
	import { app } from '#lib/client/app.svelte.ts';
	import { formatDate, formatNumber, formatValue } from '#lib/client/format.ts';
	import { showToast } from '#lib/client/toast.svelte.ts';
	import { defaultMatch, entryFields, insertRows, updateRecord } from '#lib/core/actions.ts';
	import type { FieldDef, Rec, Value, ViewDef } from '#lib/core/model.ts';
	import { parseNumber, todayIso } from '#lib/core/values.ts';
	import { createdAt } from '#lib/core/workspace.ts';
	import Button from '#lib/ui/Button.svelte';
	import { DATA_COLORS, swatch } from '#lib/ui/colors.ts';
	import Empty from '#lib/ui/Empty.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import Stepper from '#lib/ui/Stepper.svelte';
	import { checkbox, input, select } from '#lib/ui/styles.ts';

	import CellValue from './CellValue.svelte';

	let { tableId, view }: { tableId: string; view: ViewDef } = $props();

	const MANY = 12;

	const all = $derived.by(() => {
		void app.version;
		return app.ws.fields(tableId);
	});

	const fields = $derived(entryFields(all, view.config));

	const keyIds = $derived.by(() => {
		const configured = view.config.match;
		if (configured !== undefined) {
			return new Set(configured);
		}
		return new Set(defaultMatch(fields));
	});

	const keys = $derived(fields.filter((field) => keyIds.has(field.id)));
	const dateField = $derived(
		fields.find((field) => field.type === 'date' && !keyIds.has(field.id))
	);
	const others = $derived(
		fields.filter((field) => !keyIds.has(field.id) && field.id !== dateField?.id)
	);

	let values = $state<Record<string, Value>>({});
	let touched = $state<Record<string, boolean>>({});
	let texts = $state<Record<string, string>>({});
	let search = $state('');
	let adding = $state<string | null>(null);
	let newChoice = $state('');
	let started = false;

	const ordered = $derived.by(() => {
		void app.version;
		const date = dateField;
		return [...app.ws.rows(tableId)].sort((a, b) => {
			if (date !== undefined) {
				const order = String(b.data[date.id] ?? '').localeCompare(String(a.data[date.id] ?? ''));
				if (order !== 0) return order;
			}
			return createdAt(b) - createdAt(a);
		});
	});

	function matches(row: Rec): boolean {
		return keys.every((field) => (row.data[field.id] ?? null) === (values[field.id] ?? null));
	}

	const history = $derived(ordered.filter(matches));
	const last = $derived(history[0]);

	$effect(() => {
		if (started || !app.ready) return;
		started = true;
		const latest = ordered[0];
		for (const field of keys) {
			values[field.id] = latest?.data[field.id] ?? null;
		}
		if (dateField !== undefined) {
			values[dateField.id] = todayIso();
		}
	});

	function shown(field: FieldDef): Value {
		return touched[field.id]
			? (values[field.id] ?? null)
			: (last?.data[field.id] ?? values[field.id] ?? null);
	}

	function set(field: FieldDef, value: Value): void {
		values[field.id] = value;
		touched[field.id] = true;
	}

	function pickKey(field: FieldDef, value: Value): void {
		values[field.id] = values[field.id] === value ? null : value;
		touched = {};
		texts = {};
	}

	function step(field: FieldDef, direction: number): void {
		const size = field.step ?? 1;
		const current = shown(field);
		const base = typeof current === 'number' ? current : 0;
		const next = Math.max(0, Math.round((base + direction * size) * 1000) / 1000);
		set(field, next);
		texts[field.id] = formatNumber(next);
	}

	function recentChoices(field: FieldDef): string[] {
		const seen = new Set<string>();
		for (const row of ordered) {
			const value = row.data[field.id];
			if (typeof value === 'string') seen.add(value);
			if (seen.size >= MANY) break;
		}
		return [...seen];
	}

	function choiceList(field: FieldDef): { name: string; color: string | null }[] {
		if (field.choices.length <= MANY) return field.choices;
		const needle = search.trim().toLowerCase();
		if (needle !== '') {
			return field.choices.filter((choice) => choice.name.toLowerCase().includes(needle));
		}
		const recent = recentChoices(field);
		const byName = new Map(field.choices.map((choice) => [choice.name, choice]));
		const picked = values[field.id];
		const names =
			typeof picked === 'string' && !recent.includes(picked) ? [picked, ...recent] : recent;
		return names.map((name) => byName.get(name) ?? { name, color: null });
	}

	function addChoice(field: FieldDef): void {
		const name = newChoice.trim();
		adding = null;
		newChoice = '';
		if (name === '') return;
		if (!field.choices.some((choice) => choice.name === name)) {
			const choices = [
				...field.choices,
				{ name, color: DATA_COLORS[(field.choices.length % 7) + 1] }
			];
			app.apply(updateRecord(app.ws, field.id, { choices }), `Choice "${name}" added`);
		}
		if (keyIds.has(field.id)) pickKey(field, name);
		else set(field, name);
	}

	const targets = (field: FieldDef): { id: string; title: string }[] =>
		field.target === null
			? []
			: app.ws
					.rows(field.target)
					.map((row) => ({ id: row.id, title: app.ws.rowTitle(row.id) || row.id }));

	const ready = $derived(
		keys.every((field) => values[field.id] !== null && values[field.id] !== undefined)
	);

	function commit(): void {
		const row: Record<string, Value> = {};
		for (const field of keys) row[field.id] = values[field.id] ?? null;
		if (dateField !== undefined) row[dateField.id] = values[dateField.id] ?? todayIso();
		for (const field of others) row[field.id] = shown(field);

		const { changes } = insertRows(app.ws, tableId, [row]);
		const group = app.apply(changes, 'Row added');
		for (const field of others) values[field.id] = row[field.id];
		touched = {};
		texts = {};
		showToast('Row added', group?.id ?? null);
	}

	function summary(row: Rec): string {
		return others
			.map((field) => formatValue(field, row.data[field.id]))
			.filter((text) => text !== '')
			.join(' · ');
	}

	const today = todayIso();

	const numbers = $derived(others.filter((field) => field.type === 'number'));

	const recent = $derived.by(() => {
		let previous: string | null = null;
		return ordered
			.slice(0, 20)
			.reverse()
			.map((row) => {
				const value = dateField ? row.data[dateField.id] : null;
				const date = typeof value === 'string' ? value.slice(0, 10) : '';
				const changed = date !== previous;
				previous = date;
				return {
					row,
					day: !changed || date === '' ? null : date === today ? 'Today' : formatDate(date)
				};
			});
	});

	const stepperSize = $derived(numbers.length === 1 ? 'lg' : numbers.length === 2 ? 'md' : 'sm');
	const chip =
		'motion inline-flex h-control shrink-0 items-center gap-2 rounded-box px-3 font-medium transition-colors';
	const chipOff = 'bg-tint text-ink-2 hover:bg-tint-2 hover:text-ink';
	const chipOn = 'bg-fill text-on-fill';
</script>

{#if fields.length === 0}
	<Empty text="This view has no fields to fill in." />
{:else}
	<div class="flex h-full min-h-0 flex-col lg:flex-row lg:items-end">
		<div class="flex min-h-0 flex-1 flex-col justify-end overflow-hidden lg:pb-tabs-clear">
			<ul class="flex flex-col">
				{#each recent as { row, day } (row.id)}
					{#if day !== null}
						<li class="flex h-8 shrink-0 items-center gap-3 px-4 text-sm font-medium text-ink-3">
							<span class="min-w-0 flex-1 truncate">{day}</span>
							{#each numbers as field (field.id)}
								<span class="w-14 shrink-0 truncate text-right">{field.name}</span>
							{/each}
						</li>
					{/if}
					<li
						class="flex h-9 shrink-0 items-center gap-3 px-4 transition-colors motion hover:bg-tint"
					>
						<span class="min-w-0 flex-1 truncate">
							{#if keys[0] !== undefined}
								<CellValue field={keys[0]} value={row.data[keys[0].id]} />
							{:else}
								{summary(row)}
							{/if}
						</span>
						{#each numbers as field (field.id)}
							<span class="w-14 shrink-0 truncate text-right"
								><CellValue {field} value={row.data[field.id]} /></span
							>
						{/each}
					</li>
				{/each}
			</ul>
		</div>

		<section class="flex shrink-0 flex-col gap-3 p-4 pb-tabs-clear lg:w-entry">
			{#if last !== undefined && others.length > 0}
				<p class="flex items-center justify-between gap-3 text-ink-2">
					<span
						>Last time{dateField && typeof last.data[dateField.id] === 'string'
							? `, ${formatDate(String(last.data[dateField.id]))}`
							: ''}</span
					>
					<span class="truncate font-medium text-ink">{summary(last)}</span>
				</p>
			{/if}

			{#each keys as field (field.id)}
				<div class="flex flex-col gap-2">
					{#if field.type === 'choice' && field.choices.length > MANY}
						<input
							class={input}
							bind:value={search}
							placeholder="Search {field.name}"
							aria-label="Search {field.name}"
						/>
					{/if}
					{#if field.type === 'choice'}
						<div
							class="flex hide-scrollbar gap-1 max-sm:-mx-4 max-sm:overflow-x-auto max-sm:px-4 sm:flex-wrap"
						>
							{#each choiceList(field) as choice (choice.name)}
								{@const on = values[field.id] === choice.name}
								<button
									type="button"
									class="{chip} {on ? chipOn : chipOff}"
									aria-pressed={on}
									onclick={() => pickKey(field, choice.name)}
								>
									<span class="size-mark rounded-box" style={swatch(choice.color)}
									></span>{choice.name}
								</button>
							{/each}
							{#if adding === field.id}
								<form
									class="shrink-0"
									onsubmit={(event) => {
										event.preventDefault();
										addChoice(field);
									}}
								>
									<!-- svelte-ignore a11y_autofocus -->
									<input
										class="{input} w-40"
										bind:value={newChoice}
										placeholder="New choice"
										aria-label="New choice"
										autofocus
										onblur={() => addChoice(field)}
									/>
								</form>
							{:else}
								<button type="button" class="{chip} {chipOff}" onclick={() => (adding = field.id)}>
									<Icon name="plus" /> New
								</button>
							{/if}
						</div>
					{:else if field.type === 'link'}
						<select
							class={select}
							aria-label={field.name}
							value={values[field.id] ?? ''}
							onchange={(event) => pickKey(field, event.currentTarget.value || null)}
						>
							<option value="">Choose {field.name}</option>
							{#each targets(field) as target (target.id)}
								<option value={target.id}>{target.title}</option>
							{/each}
						</select>
					{:else}
						<input
							class={input}
							aria-label={field.name}
							placeholder={field.name}
							value={values[field.id] ?? ''}
							oninput={(event) => pickKey(field, event.currentTarget.value || null)}
						/>
					{/if}
				</div>
			{/each}

			{#each others as field (field.id)}
				{@const value = shown(field)}
				{#if field.type === 'number'}
					<Stepper
						label={field.name}
						size={stepperSize}
						ghost={!touched[field.id]}
						text={texts[field.id] ?? (typeof value === 'number' ? formatNumber(value) : '')}
						oninput={(text) => {
							texts[field.id] = text;
							set(field, parseNumber(text));
						}}
						onstep={(direction) => step(field, direction)}
					/>
				{:else if field.type === 'choice'}
					<div class="flex flex-col gap-1">
						<span class="text-sm font-medium text-ink-2">{field.name}</span>
						<div class="flex flex-wrap gap-1">
							{#each field.choices as choice (choice.name)}
								{@const on = value === choice.name}
								<button
									type="button"
									class="{chip} {on ? chipOn : chipOff}"
									aria-pressed={on}
									onclick={() => set(field, on ? null : choice.name)}
								>
									<span class="size-mark rounded-box" style={swatch(choice.color)}
									></span>{choice.name}
								</button>
							{/each}
						</div>
					</div>
				{:else if field.type === 'check'}
					<label class="flex min-h-control items-center gap-2">
						<input
							type="checkbox"
							class={checkbox}
							checked={value === true}
							onchange={() => set(field, value !== true)}
						/>
						{field.name}
					</label>
				{:else if field.type === 'link'}
					<select
						class={select}
						aria-label={field.name}
						value={value ?? ''}
						onchange={(event) => set(field, event.currentTarget.value || null)}
					>
						<option value="">Choose {field.name}</option>
						{#each targets(field) as target (target.id)}
							<option value={target.id}>{target.title}</option>
						{/each}
					</select>
				{:else if field.type === 'date'}
					<input
						class={input}
						type="date"
						aria-label={field.name}
						value={typeof value === 'string' ? value.slice(0, 10) : ''}
						oninput={(event) => set(field, event.currentTarget.value || null)}
					/>
				{:else}
					<input
						class={input}
						aria-label={field.name}
						placeholder={field.name}
						value={typeof value === 'string' ? value : ''}
						oninput={(event) => set(field, event.currentTarget.value || null)}
					/>
				{/if}
			{/each}

			{#if dateField !== undefined}
				<label class="flex items-center justify-between gap-3 text-ink-2">
					{dateField.name}
					<input
						class="{input} w-auto"
						type="date"
						value={String(values[dateField.id] ?? today).slice(0, 10)}
						oninput={(event) => {
							if (dateField) values[dateField.id] = event.currentTarget.value || today;
						}}
					/>
				</label>
			{/if}

			<Button variant="primary" size="cta" disabled={!ready} onclick={commit}>Add row</Button>
		</section>
	</div>
{/if}
