<script lang="ts">
	import { untrack } from 'svelte';

	import { goto } from '$app/navigation';

	import { app } from '#lib/client/app.svelte.ts';
	import { tableUrl } from '#lib/client/nav.ts';
	import { showToast } from '#lib/client/toast.svelte.ts';
	import { createView, defaultMatch, deleteRecords, updateRecord } from '#lib/core/actions.ts';
	import type { ChartConfig, FieldDef, Value, ViewConfig, ViewType } from '#lib/core/model.ts';
	import Button from '#lib/ui/Button.svelte';
	import Field from '#lib/ui/Field.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';
	import { checkbox, input, legend, select } from '#lib/ui/styles.ts';

	let {
		open = $bindable(false),
		tableId,
		viewId = null
	}: { open?: boolean; tableId: string; viewId?: string | null } = $props();

	const TYPES: { id: ViewType; label: string; hint: string }[] = [
		{ id: 'grid', label: 'Grid', hint: 'Every row, as a sheet' },
		{ id: 'entry', label: 'Entry', hint: 'Add rows fast, filled in from last time' },
		{ id: 'list', label: 'List', hint: 'Rows grouped under headings' },
		{ id: 'chart', label: 'Chart', hint: 'Bars or a line of one value' }
	];

	let name = $state('');
	let type = $state<ViewType>('grid');
	let config = $state<ViewConfig>({});
	let start = $state('');

	const snapshot = (): string => JSON.stringify({ name, type, config });
	const dirty = $derived(open && snapshot() !== start);

	const existing = $derived(viewId === null ? undefined : app.ws.view(viewId));

	const fields = $derived.by(() => {
		void app.version;
		return app.ws.fields(tableId);
	});

	$effect(() => {
		if (open) {
			const view = viewId === null ? undefined : app.ws.view(viewId);
			name = view?.name ?? '';
			type = view?.type ?? 'grid';
			config = structuredClone($state.snapshot(view?.config ?? {}));
			start = untrack(snapshot);
		}
	});

	function toggle(
		key: 'hidden' | 'fields' | 'match' | 'show',
		id: string,
		fallback: string[]
	): void {
		const list = config[key] ?? fallback;
		config[key] = list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
	}

	const entryFields = $derived(fields.filter((field) => field.type !== 'formula'));
	const keyCandidates = $derived(
		entryFields.filter(
			(field) => field.type === 'choice' || field.type === 'link' || field.type === 'text'
		)
	);
	const fallbackMatch = $derived(defaultMatch(entryFields));
	const numeric = $derived(
		fields.filter((field) => field.type === 'number' || field.type === 'formula')
	);
	const choices = $derived(fields.filter((field) => field.type === 'choice'));
	const xField = $derived(config.x ? fields.find((field) => field.id === config.x) : undefined);

	function setChart<K extends keyof ChartConfig>(key: K, value: ChartConfig[K]): void {
		config[key] = value as ViewConfig[K];
	}

	function save(): void {
		const label = name.trim() || (TYPES.find((option) => option.id === type)?.label ?? 'View');
		const clean = JSON.parse(JSON.stringify(config)) as Value;

		if (existing === undefined) {
			const { id, changes } = createView(app.ws, tableId, {
				name: label,
				type,
				config: clean as ViewConfig
			});
			app.apply(changes, `View "${label}" added`);
			void goto(tableUrl(tableId, id));
		} else {
			app.apply(
				updateRecord(app.ws, existing.id, { name: label, config: clean }),
				`View "${label}" changed`
			);
		}
		open = false;
	}

	function remove(): void {
		if (existing === undefined) return;
		const group = app.apply(
			deleteRecords(app.ws, [existing.id]),
			`View "${existing.name}" deleted`
		);
		showToast(`View "${existing.name}" deleted`, group?.id ?? null);
		open = false;
		void goto(tableUrl(tableId));
	}

	const checked = (
		key: 'hidden' | 'fields' | 'match' | 'show',
		field: FieldDef,
		fallback: string[]
	): boolean => (config[key] ?? fallback).includes(field.id);
</script>

<Sheet bind:open title={existing === undefined ? 'New view' : 'View settings'} {dirty}>
	<div class="flex flex-col gap-3">
		{#if existing === undefined}
			<div class="grid grid-cols-2 gap-1">
				{#each TYPES as option (option.id)}
					<button
						type="button"
						class="flex flex-col gap-1 rounded-box p-3 text-left transition-colors motion {type ===
						option.id
							? 'bg-fill text-on-fill'
							: 'bg-tint hover:bg-tint-2'}"
						aria-pressed={type === option.id}
						onclick={() => (type = option.id)}
					>
						<span class="font-semibold">{option.label}</span>
						<span class="text-sm opacity-70">{option.hint}</span>
					</button>
				{/each}
			</div>
		{/if}

		<Field label="Name">
			<input
				class={input}
				bind:value={name}
				placeholder={TYPES.find((option) => option.id === type)?.label}
			/>
		</Field>

		{#if type === 'grid'}
			<fieldset class="flex flex-col gap-1">
				<legend class={legend}>Fields shown</legend>
				{#each fields as field (field.id)}
					<label class="flex min-h-control items-center gap-2">
						<input
							type="checkbox"
							class={checkbox}
							checked={!checked('hidden', field, [])}
							onchange={() => toggle('hidden', field.id, [])}
						/>
						{field.name}
					</label>
				{/each}
			</fieldset>
		{:else if type === 'entry'}
			<fieldset class="flex flex-col gap-1">
				<legend class={legend}>Fields to fill in</legend>
				{#each entryFields as field (field.id)}
					<label class="flex min-h-control items-center gap-2">
						<input
							type="checkbox"
							class={checkbox}
							checked={checked(
								'fields',
								field,
								entryFields.map((item) => item.id)
							)}
							onchange={() =>
								toggle(
									'fields',
									field.id,
									entryFields.map((item) => item.id)
								)}
						/>
						{field.name}
					</label>
				{/each}
			</fieldset>
			<fieldset class="flex flex-col gap-1">
				<legend class={legend}>"Last time" looks at</legend>
				<p class="mb-1 text-sm text-ink-3">
					Entry fills in from the latest row with the same values in these fields, for example the
					same exercise.
				</p>
				{#each keyCandidates as field (field.id)}
					<label class="flex min-h-control items-center gap-2">
						<input
							type="checkbox"
							class={checkbox}
							checked={checked('match', field, fallbackMatch)}
							onchange={() => toggle('match', field.id, fallbackMatch)}
						/>
						{field.name}
					</label>
				{/each}
			</fieldset>
		{:else if type === 'list'}
			<Field label="Group by">
				<select
					class={select}
					value={config.group ?? ''}
					onchange={(event) => (config.group = event.currentTarget.value || null)}
				>
					<option value="">Nothing</option>
					{#each fields as field (field.id)}
						<option value={field.id}>{field.name}</option>
					{/each}
				</select>
			</Field>
			<Field label="Title">
				<select
					class={select}
					value={config.title ?? ''}
					onchange={(event) => (config.title = event.currentTarget.value || null)}
				>
					<option value="">Automatic</option>
					{#each fields as field (field.id)}
						<option value={field.id}>{field.name}</option>
					{/each}
				</select>
			</Field>
			<fieldset class="flex flex-col gap-1">
				<legend class={legend}>Fields under the title</legend>
				{#each fields as field (field.id)}
					<label class="flex min-h-control items-center gap-2">
						<input
							type="checkbox"
							class={checkbox}
							checked={checked('show', field, [])}
							onchange={() => toggle('show', field.id, [])}
						/>
						{field.name}
					</label>
				{/each}
			</fieldset>
		{:else}
			<div class="grid grid-cols-2 gap-1">
				{#each [{ id: 'bar', label: 'Bars' }, { id: 'line', label: 'Line' }] as option (option.id)}
					<button
						type="button"
						class="h-control rounded-box font-medium transition-colors motion {(config.kind ??
							'bar') === option.id
							? 'bg-fill text-on-fill'
							: 'bg-tint hover:bg-tint-2'}"
						onclick={() => setChart('kind', option.id as 'bar' | 'line')}>{option.label}</button
					>
				{/each}
			</div>
			<Field label="Horizontal axis">
				<select
					class={select}
					value={config.x ?? ''}
					onchange={(event) => setChart('x', event.currentTarget.value || null)}
				>
					<option value=""></option>
					{#each fields as field (field.id)}
						<option value={field.id}>{field.name}</option>
					{/each}
				</select>
			</Field>
			{#if xField?.type === 'date'}
				<Field label="Group dates by">
					<select
						class={select}
						value={config.bucket ?? 'day'}
						onchange={(event) =>
							setChart('bucket', event.currentTarget.value as ChartConfig['bucket'])}
					>
						<option value="day">Day</option>
						<option value="week">Week</option>
						<option value="month">Month</option>
					</select>
				</Field>
			{/if}
			<div class="grid grid-cols-2 gap-3">
				<Field label="Calculation">
					<select
						class={select}
						value={config.agg ?? 'count'}
						onchange={(event) => setChart('agg', event.currentTarget.value as ChartConfig['agg'])}
					>
						<option value="count">Row count</option>
						<option value="sum">Sum</option>
						<option value="avg">Average</option>
						<option value="max">Highest</option>
						<option value="min">Lowest</option>
					</select>
				</Field>
				<Field label="Of">
					<select
						class={select}
						value={config.y ?? ''}
						disabled={(config.agg ?? 'count') === 'count'}
						onchange={(event) => setChart('y', event.currentTarget.value || null)}
					>
						<option value=""></option>
						{#each numeric as field (field.id)}
							<option value={field.id}>{field.name}</option>
						{/each}
					</select>
				</Field>
			</div>
			<Field label="Colour by">
				<select
					class={select}
					value={config.color ?? ''}
					onchange={(event) => setChart('color', event.currentTarget.value || null)}
				>
					<option value="">One series</option>
					{#each choices as field (field.id)}
						<option value={field.id}>{field.name}</option>
					{/each}
				</select>
			</Field>
			{#if (config.kind ?? 'bar') === 'line' && xField?.type === 'date'}
				<Field
					label="Rolling average (days)"
					hint="Empty for the raw line. 7 smooths a daily weigh-in."
				>
					<input
						class={input}
						inputmode="numeric"
						value={config.rolling ?? ''}
						oninput={(event) => {
							const days = Number(event.currentTarget.value);
							setChart('rolling', Number.isInteger(days) && days > 1 ? days : null);
						}}
					/>
				</Field>
			{/if}
		{/if}
	</div>

	{#snippet footer()}
		{#if existing !== undefined}
			<Button variant="ghost" onclick={remove}>Delete</Button>
		{/if}
		<div class="flex-1"></div>
		<Button variant="primary" onclick={save}>{existing === undefined ? 'Create' : 'Save'}</Button>
	{/snippet}
</Sheet>
