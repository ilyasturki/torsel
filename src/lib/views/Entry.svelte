<script lang="ts">
	import Minus from '@lucide/svelte/icons/minus';
	import Plus from '@lucide/svelte/icons/plus';
	import Search from '@lucide/svelte/icons/search';

	import { app } from '#lib/client/app.svelte.ts';
	import { formatDate, formatNumber, formatValue } from '#lib/client/format.ts';
	import { showToast } from '#lib/client/toast.svelte.ts';
	import { defaultMatch, entryFields, insertRows, updateRecord } from '#lib/core/actions.ts';
	import type { FieldDef, Rec, Value, ViewDef } from '#lib/core/model.ts';
	import { parseNumber, todayIso } from '#lib/core/values.ts';
	import { createdAt } from '#lib/core/workspace.ts';
	import { DATA_COLORS, chipStyle } from '#lib/ui/colors.ts';
	import { input, select } from '#lib/ui/styles.ts';

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
			app.apply(updateRecord(app.ws, field.id, { choices }), `Choix « ${name} » ajouté`);
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
		const group = app.apply(changes, 'Ligne ajoutée');
		for (const field of others) values[field.id] = row[field.id];
		touched = {};
		texts = {};
		showToast('Ajouté', group?.id ?? null);
	}

	function summary(row: Rec): string {
		return others
			.map((field) => formatValue(field, row.data[field.id]))
			.filter((text) => text !== '')
			.join(' · ');
	}

	const today = todayIso();
</script>

{#if fields.length === 0}
	<p class="rounded-2xl bg-surface px-4 py-10 text-center text-ink-muted">
		Cette vue n’a aucun champ à saisir.
	</p>
{:else}
	<div class="mx-auto flex w-full max-w-xl flex-col gap-3">
		<section class="flex flex-col gap-5 rounded-3xl bg-surface p-4 sm:p-5">
			{#each keys as field (field.id)}
				<div class="flex flex-col gap-2">
					<div class="flex items-center gap-2">
						<span class="text-[13px] font-medium text-ink-muted">{field.name}</span>
						{#if field.type === 'choice' && field.choices.length > MANY}
							<label
								class="ml-auto flex h-9 items-center gap-2 rounded-full bg-surface-2 px-3 text-sm"
							>
								<Search class="size-4 text-ink-faint" />
								<input
									class="w-32 bg-transparent outline-none"
									bind:value={search}
									placeholder="Chercher"
								/>
							</label>
						{/if}
					</div>
					{#if field.type === 'choice'}
						<div class="flex flex-wrap gap-2">
							{#each choiceList(field) as choice (choice.name)}
								{@const on = values[field.id] === choice.name}
								<button
									type="button"
									class="min-h-11 rounded-full px-4 text-[15px] font-medium {on
										? 'bg-fill text-on-fill'
										: ''}"
									style={on ? '' : chipStyle(choice.color)}
									aria-pressed={on}
									onclick={() => pickKey(field, choice.name)}>{choice.name}</button
								>
							{/each}
							{#if adding === field.id}
								<form
									class="flex gap-2"
									onsubmit={(event) => {
										event.preventDefault();
										addChoice(field);
									}}
								>
									<!-- svelte-ignore a11y_autofocus -->
									<input
										class="{input} w-44"
										bind:value={newChoice}
										placeholder="Nouveau"
										autofocus
										onblur={() => addChoice(field)}
									/>
								</form>
							{:else}
								<button
									type="button"
									class="flex min-h-11 items-center gap-1 rounded-full border border-dashed border-line px-4 text-[15px] text-ink-muted"
									onclick={() => (adding = field.id)}><Plus class="size-4" /> Nouveau</button
								>
							{/if}
						</div>
					{:else if field.type === 'link'}
						<select
							class={select}
							value={values[field.id] ?? ''}
							onchange={(event) => pickKey(field, event.currentTarget.value || null)}
						>
							<option value="">—</option>
							{#each targets(field) as target (target.id)}
								<option value={target.id}>{target.title}</option>
							{/each}
						</select>
					{:else}
						<input
							class={input}
							value={values[field.id] ?? ''}
							oninput={(event) => pickKey(field, event.currentTarget.value || null)}
						/>
					{/if}
				</div>
			{/each}

			{#if last !== undefined && others.length > 0}
				<p class="-mt-1 text-[13px] text-ink-muted">
					La dernière fois{dateField && typeof last.data[dateField.id] === 'string'
						? `, le ${formatDate(String(last.data[dateField.id]))}`
						: ''} :
					<span class="text-ink">{summary(last)}</span>
				</p>
			{/if}

			<div class="grid grid-cols-2 gap-3">
				{#each others as field (field.id)}
					{@const value = shown(field)}
					{@const ghost = !touched[field.id]}
					<div class="flex flex-col gap-1.5 {field.type === 'number' ? '' : 'col-span-2'}">
						<span class="text-[13px] font-medium text-ink-muted">{field.name}</span>
						{#if field.type === 'number'}
							<div class="flex h-14 items-center rounded-2xl bg-surface-2">
								<button
									type="button"
									class="flex size-14 items-center justify-center"
									aria-label="Moins"
									onclick={() => step(field, -1)}><Minus class="size-5" /></button
								>
								<input
									class="w-full min-w-0 bg-transparent text-center text-2xl font-semibold outline-none {ghost
										? 'text-ink-muted'
										: 'text-ink'}"
									inputmode="decimal"
									aria-label={field.name}
									value={texts[field.id] ?? (typeof value === 'number' ? formatNumber(value) : '')}
									placeholder="—"
									oninput={(event) => {
										texts[field.id] = event.currentTarget.value;
										set(field, parseNumber(event.currentTarget.value));
									}}
								/>
								<button
									type="button"
									class="flex size-14 items-center justify-center"
									aria-label="Plus"
									onclick={() => step(field, 1)}><Plus class="size-5" /></button
								>
							</div>
						{:else if field.type === 'choice'}
							<div class="flex flex-wrap gap-2">
								{#each field.choices as choice (choice.name)}
									{@const on = value === choice.name}
									<button
										type="button"
										class="min-h-10 rounded-full px-3 text-sm font-medium {on
											? 'bg-fill text-on-fill'
											: ''}"
										style={on ? '' : chipStyle(choice.color)}
										onclick={() => set(field, on ? null : choice.name)}>{choice.name}</button
									>
								{/each}
							</div>
						{:else if field.type === 'check'}
							<button
								type="button"
								role="switch"
								aria-checked={value === true}
								aria-label={field.name}
								class="relative h-9 w-16 rounded-full transition-colors {value === true
									? 'bg-fill'
									: 'bg-sunken'}"
								onclick={() => set(field, value !== true)}
							>
								<span
									class="absolute top-1 size-7 rounded-full bg-surface shadow transition-all {value ===
									true
										? 'left-8'
										: 'left-1'}"
								></span>
							</button>
						{:else if field.type === 'link'}
							<select
								class={select}
								value={value ?? ''}
								onchange={(event) => set(field, event.currentTarget.value || null)}
							>
								<option value="">—</option>
								{#each targets(field) as target (target.id)}
									<option value={target.id}>{target.title}</option>
								{/each}
							</select>
						{:else if field.type === 'date'}
							<input
								class={input}
								type="date"
								value={typeof value === 'string' ? value.slice(0, 10) : ''}
								oninput={(event) => set(field, event.currentTarget.value || null)}
							/>
						{:else}
							<input
								class={input}
								value={typeof value === 'string' ? value : ''}
								oninput={(event) => set(field, event.currentTarget.value || null)}
							/>
						{/if}
					</div>
				{/each}
			</div>

			{#if dateField !== undefined}
				<label class="flex items-center justify-between gap-3 text-[13px] text-ink-muted">
					{dateField.name}
					<input
						class="h-10 rounded-xl border border-line bg-surface px-3 text-[15px] text-ink"
						type="date"
						value={String(values[dateField.id] ?? today).slice(0, 10)}
						oninput={(event) => {
							if (dateField) values[dateField.id] = event.currentTarget.value || today;
						}}
					/>
				</label>
			{/if}

			<button
				type="button"
				class="h-16 rounded-2xl bg-fill text-lg font-semibold text-on-fill disabled:opacity-40"
				disabled={!ready}
				onclick={commit}>Ajouter</button
			>
		</section>

		{#if history.length > 0}
			<section class="rounded-3xl bg-surface p-2">
				<h2 class="px-3 pt-2 pb-1 text-[13px] font-medium text-ink-muted">Dernières lignes</h2>
				<ul>
					{#each history.slice(0, 8) as row (row.id)}
						{@const day = dateField ? row.data[dateField.id] : null}
						<li class="flex items-center gap-3 rounded-xl px-3 py-2.5">
							<span
								class="w-16 shrink-0 text-[13px] {day === today
									? 'font-semibold text-ink'
									: 'text-ink-muted'}"
							>
								{typeof day === 'string'
									? day.slice(0, 10) === today
										? 'Auj.'
										: formatDate(day)
									: ''}
							</span>
							<span class="min-w-0 flex-1 truncate text-[15px]">{summary(row) || '—'}</span>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	</div>
{/if}
