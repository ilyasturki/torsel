<script lang="ts">
	import { untrack } from 'svelte';

	import { goto } from '$app/navigation';

	import { app } from '#lib/client/app.svelte.ts';
	import { tableUrl } from '#lib/client/nav.ts';
	import { applyWithUndo, showToast } from '#lib/client/toast.svelte.ts';
	import {
		chartAxis,
		createView,
		defaultMatch,
		deleteRecords,
		entryFields,
		listLayout,
		reorder,
		shifted,
		updateRecord
	} from '#lib/core/actions.ts';
	import type { ChartConfig, FieldDef, Value, ViewConfig, ViewType } from '#lib/core/model.ts';
	import { isDated, isNumeric } from '#lib/core/model.ts';
	import Button from '#lib/ui/Button.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import Field from '#lib/ui/Field.svelte';
	import { fieldIcon } from '#lib/ui/field-icons.ts';
	import Icon from '#lib/ui/Icon.svelte';
	import Select, { type Option } from '#lib/ui/Select.svelte';
	import { checkbox, input, legend } from '#lib/ui/styles.ts';

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

	const existing = $derived.by(() => {
		void app.version;
		return viewId === null ? undefined : app.ws.view(viewId);
	});

	const fields = $derived.by(() => {
		void app.version;
		return app.ws.fields(tableId);
	});

	const siblings = $derived.by(() => {
		void app.version;
		return app.ws.views(tableId);
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

	const labelOf = (id: ViewType): string =>
		TYPES.find((option) => option.id === id)?.label ?? 'View';

	function pickType(next: ViewType): void {
		if (name === labelOf(type)) name = labelOf(next);
		type = next;
	}

	function toggle(
		key: 'hidden' | 'fields' | 'match' | 'show',
		id: string,
		fallback: string[]
	): void {
		const list = config[key] ?? fallback;
		config[key] = list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
	}

	const fillable = $derived(fields.filter((field) => field.type !== 'formula'));
	const fillIn = $derived(entryFields(fields, config).map((field) => field.id));
	const keyCandidates = $derived(
		fillable.filter(
			(field) => field.type === 'choice' || field.type === 'link' || field.type === 'text'
		)
	);
	const fallbackMatch = $derived(defaultMatch(entryFields(fields, config)));
	const numeric = $derived(
		fields.filter((field) => isNumeric(field.type) || field.type === 'formula')
	);
	const choices = $derived(fields.filter((field) => field.type === 'choice'));
	const layout = $derived(listLayout(fields, config));
	const autoLayout = $derived(
		listLayout(fields, { ...config, group: undefined, title: undefined })
	);
	const fieldOptions = (list: FieldDef[]): Option[] =>
		list.map((field) => ({ value: field.id, label: field.name, icon: fieldIcon(field.type) }));

	const axis = $derived(chartAxis(fields, config));
	const xField = $derived(fields.find((field) => field.id === axis));

	function setChart<K extends keyof ChartConfig>(key: K, value: ChartConfig[K]): void {
		config[key] = value as ViewConfig[K];
	}

	function setAgg(agg: ChartConfig['agg']): void {
		setChart('agg', agg);
		if (agg !== 'count' && !config.y) setChart('y', numeric[0]?.id ?? null);
	}

	function setGroup(value: string): void {
		if (value === 'auto') delete config.group;
		else config.group = value || null;
	}

	function unusedName(label: string): string {
		const taken = new Set(siblings.map((view) => view.name));
		let unused = label;
		for (let n = 2; taken.has(unused); n += 1) unused = `${label} ${n}`;
		return unused;
	}

	function save(): void {
		const clean = JSON.parse(JSON.stringify(config)) as Value;

		if (existing === undefined) {
			const label = name.trim() || unusedName(labelOf(type));
			const { id, changes } = createView(app.ws, tableId, {
				name: label,
				type,
				config: clean as ViewConfig
			});
			applyWithUndo(changes, `View "${label}" added`);
			void goto(tableUrl(tableId, id));
		} else {
			const label = name.trim() || labelOf(type);
			applyWithUndo(
				updateRecord(app.ws, existing.id, { name: label, type, config: clean }),
				`View "${label}" changed`
			);
		}
		open = false;
	}

	function remove(): void {
		if (existing === undefined) return;
		const label = `View "${existing.name}" deleted`;
		const group = app.apply(deleteRecords(app.ws, [existing.id]), label);
		showToast(label, group?.id ?? null);
		open = false;
		void goto(tableUrl(tableId));
	}

	function move(by: number): void {
		if (existing !== undefined) {
			const ids = siblings.map((view) => view.id);
			applyWithUndo(
				reorder(app.ws, shifted(ids, existing.id, by)),
				`View "${existing.name}" moved`
			);
		}
	}

	const checked = (
		key: 'hidden' | 'fields' | 'match' | 'show',
		field: FieldDef,
		fallback: string[]
	): boolean => (config[key] ?? fallback).includes(field.id);
</script>

<Dialog
	bind:open
	title={existing === undefined ? 'New view' : 'View settings'}
	{dirty}
	onsubmit={save}
>
	<div class="flex flex-col gap-3">
		<div class="grid grid-cols-2 gap-1" role="group" aria-label="View type">
			{#each TYPES as option (option.id)}
				<button
					type="button"
					class="flex flex-col gap-1 rounded-box p-3 text-left transition-colors motion {type ===
					option.id
						? 'bg-fill text-on-fill'
						: 'bg-tint hover:bg-tint-2'}"
					aria-pressed={type === option.id}
					onclick={() => pickType(option.id)}
				>
					<span class="font-semibold">{option.label}</span>
					<span class="text-sm opacity-70">{option.hint}</span>
				</button>
			{/each}
		</div>

		<Field label="Name">
			<input class={input} bind:value={name} placeholder={labelOf(type)} />
		</Field>

		{#if type === 'grid'}
			<div class="grid grid-cols-2 gap-3">
				<Field label="Sort by">
					<Select
						options={[{ value: '', label: 'None, oldest first' }, ...fieldOptions(fields)]}
						value={config.sort?.field ?? ''}
						onchange={(field) => {
							config.sort = field ? { field, dir: config.sort?.dir ?? 'asc' } : null;
						}}
					/>
				</Field>
				<Field label="Order">
					<Select
						options={[
							{ value: 'asc', label: 'Ascending', icon: 'arrow-up' },
							{ value: 'desc', label: 'Descending', icon: 'arrow-down' }
						]}
						disabled={!config.sort}
						value={config.sort?.dir ?? 'asc'}
						onchange={(dir) => {
							if (config.sort) config.sort.dir = dir;
						}}
					/>
				</Field>
			</div>
			{#if config.filter}
				<div class="flex items-center gap-2">
					<span class="min-w-0 flex-1 truncate">
						Only rows where {fields.find((field) => field.id === config.filter?.field)?.name} contains
						"{config.filter.text}"
					</span>
					<Button variant="ghost" onclick={() => (config.filter = null)}>Clear filter</Button>
				</div>
			{/if}
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
				{#each fillable as field (field.id)}
					<label class="flex min-h-control items-center gap-2">
						<input
							type="checkbox"
							class={checkbox}
							checked={checked('fields', field, fillIn)}
							onchange={() => toggle('fields', field.id, fillIn)}
						/>
						{field.name}
					</label>
				{/each}
			</fieldset>
			<fieldset class="flex flex-col gap-1">
				<legend class={legend}>"Last time" matches on</legend>
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
				<Select
					options={[
						{ value: 'auto', label: `Automatic (${autoLayout.group?.name ?? 'nothing'})` },
						{ value: '', label: 'Nothing' },
						...fieldOptions(fields)
					]}
					value={config.group === undefined ? 'auto' : (config.group ?? '')}
					onchange={setGroup}
				/>
			</Field>
			<Field label="Title">
				<Select
					options={[
						{
							value: '',
							label: `Automatic (${listLayout(fields, { ...config, title: undefined }).title?.name ?? 'none'})`
						},
						...fieldOptions(fields)
					]}
					value={config.title ?? ''}
					onchange={(title) => (config.title = title || null)}
				/>
			</Field>
			<fieldset class="flex flex-col gap-1">
				<legend class={legend}>Fields under the title</legend>
				{#each fields as field (field.id)}
					<label class="flex min-h-control items-center gap-2">
						<input
							type="checkbox"
							class={checkbox}
							checked={layout.show.some((item) => item.id === field.id)}
							onchange={() =>
								toggle(
									'show',
									field.id,
									layout.show.map((item) => item.id)
								)}
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
				<Select
					options={fieldOptions(fields)}
					value={axis ?? ''}
					onchange={(x) => setChart('x', x || null)}
				/>
			</Field>
			{#if isDated(xField?.type ?? 'text')}
				<Field label="Group dates by">
					<Select
						options={[
							{ value: 'day', label: 'Day' },
							{ value: 'week', label: 'Week' },
							{ value: 'month', label: 'Month' }
						]}
						value={config.bucket ?? 'day'}
						onchange={(bucket) => setChart('bucket', bucket)}
					/>
				</Field>
			{/if}
			<div class="grid grid-cols-2 gap-3">
				<Field label="Calculation">
					<Select
						options={[
							{ value: 'count', label: 'Row count' },
							{ value: 'sum', label: 'Sum' },
							{ value: 'avg', label: 'Average' },
							{ value: 'max', label: 'Highest' },
							{ value: 'min', label: 'Lowest' }
						]}
						value={config.agg ?? 'count'}
						onchange={setAgg}
					/>
				</Field>
				<Field label="Of">
					<Select
						options={fieldOptions(numeric)}
						value={config.y ?? ''}
						disabled={(config.agg ?? 'count') === 'count'}
						onchange={(y) => setChart('y', y || null)}
					/>
				</Field>
			</div>
			<Field label="Colour by">
				<Select
					options={[{ value: '', label: 'One series' }, ...fieldOptions(choices)]}
					value={config.color ?? ''}
					onchange={(color) => setChart('color', color || null)}
				/>
			</Field>
			{#if (config.kind ?? 'bar') === 'line' && isDated(xField?.type ?? 'text')}
				<Field label="Rolling average (days)">
					<input
						class={input}
						inputmode="numeric"
						placeholder="7"
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
			<Button
				variant="ghost"
				class="w-control px-0"
				aria-label="Move left"
				disabled={siblings[0]?.id === existing.id}
				onclick={() => move(-1)}><Icon name="arrow-left" /></Button
			>
			<Button
				variant="ghost"
				class="w-control px-0"
				aria-label="Move right"
				disabled={siblings.at(-1)?.id === existing.id}
				onclick={() => move(1)}><Icon name="arrow-right" /></Button
			>
		{/if}
		<div class="flex-1"></div>
		<Button variant="primary" onclick={save}>{existing === undefined ? 'Create' : 'Save'}</Button>
	{/snippet}
</Dialog>
