<script lang="ts">
	import { untrack } from 'svelte';

	import { goto } from '$app/navigation';

	import { app } from '#lib/client/app.svelte.ts';
	import { tableUrl } from '#lib/client/nav.ts';
	import { applyWithUndo, showToast } from '#lib/client/toast.svelte.ts';
	import {
		chartAxis,
		defaultMatch,
		deleteRecords,
		entryFields,
		listLayout,
		updateRecord
	} from '#lib/core/actions.ts';
	import type { ChartConfig, FieldDef, Value, ViewConfig, ViewType } from '#lib/core/model.ts';
	import { isDated, isNumeric } from '#lib/core/model.ts';
	import { common } from '#lib/i18n/common.ts';
	import { views as words } from '#lib/i18n/views.ts';
	import Button from '#lib/ui/Button.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import Field from '#lib/ui/Field.svelte';
	import { fieldIcon } from '#lib/ui/field-icons.ts';
	import Icon from '#lib/ui/Icon.svelte';
	import Select, { type Option } from '#lib/ui/Select.svelte';
	import { checkbox, focus, input, legend } from '#lib/ui/styles.ts';

	import { VIEW_TYPES, viewLabel } from './views.ts';

	let {
		open = $bindable(false),
		tableId,
		viewId
	}: { open?: boolean; tableId: string; viewId: string } = $props();

	let name = $state('');
	let type = $state<ViewType>('grid');
	let config = $state<ViewConfig>({});
	let start = $state('');

	const snapshot = (): string => JSON.stringify({ name, type, config });
	const dirty = $derived(open && snapshot() !== start);

	const existing = $derived.by(() => {
		void app.version;
		return app.ws.view(viewId);
	});

	const fields = $derived.by(() => {
		void app.version;
		return app.ws.fields(tableId);
	});

	$effect(() => {
		if (open) {
			const view = app.ws.view(viewId);
			name = view?.name ?? '';
			type = view?.type ?? 'grid';
			config = structuredClone($state.snapshot(view?.config ?? {}));
			start = untrack(snapshot);
		}
	});

	function pickType(next: ViewType): void {
		if (name === viewLabel(type)) name = viewLabel(next);
		type = next;
	}

	function toggle(
		key: 'hidden' | 'fields' | 'match' | 'show',
		id: string,
		fallback: string[]
	): void {
		const list = config[key] ?? fallback;
		const next = list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
		const at = (item: string): number => fields.findIndex((field) => field.id === item);
		config[key] = key === 'match' ? next.sort((a, b) => at(a) - at(b)) : next;
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

	function save(): void {
		if (existing !== undefined) {
			const label = name.trim() || viewLabel(type);
			const clean = JSON.parse(JSON.stringify(config)) as Value;
			applyWithUndo(
				updateRecord(app.ws, existing.id, { name: label, type, config: clean }),
				words.viewChanged(label)
			);
		}
		open = false;
	}

	function remove(): void {
		if (existing === undefined) return;
		const label = words.viewDeleted(existing.name);
		const group = app.apply(deleteRecords(app.ws, [existing.id]), label);
		showToast(label, group?.id ?? null);
		open = false;
		void goto(tableUrl(tableId));
	}

	const checked = (
		key: 'hidden' | 'fields' | 'match' | 'show',
		field: FieldDef,
		fallback: string[]
	): boolean => (config[key] ?? fallback).includes(field.id);
</script>

<Dialog bind:open title={words.viewSettings} {dirty} onsubmit={save}>
	<div class="flex flex-col gap-3">
		<Field label={words.name}>
			<input class={input} bind:value={name} placeholder={viewLabel(type)} />
		</Field>

		<div class="grid grid-cols-4 gap-1" role="group" aria-label={words.viewType}>
			{#each VIEW_TYPES as option (option.id)}
				<button
					type="button"
					class="flex h-control items-center justify-center gap-2 rounded-box font-medium transition-colors motion max-sm:h-auto max-sm:flex-col max-sm:gap-1 max-sm:py-2 {focus} {type ===
					option.id
						? 'bg-fill text-on-fill'
						: 'bg-tint text-ink-2 hover:bg-tint-2 hover:text-ink'}"
					aria-pressed={type === option.id}
					onclick={() => pickType(option.id)}
				>
					<Icon name={option.icon} /><span class="max-sm:text-sm">{viewLabel(option.id)}</span>
				</button>
			{/each}
		</div>

		{#if type === 'grid'}
			<div class="grid grid-cols-2 gap-3">
				<Field label={words.sortBy}>
					<Select
						options={[{ value: '', label: words.unsorted }, ...fieldOptions(fields)]}
						value={config.sort?.field ?? ''}
						onchange={(field) => {
							config.sort = field ? { field, dir: config.sort?.dir ?? 'asc' } : null;
						}}
					/>
				</Field>
				<Field label={words.order}>
					<Select
						options={[
							{ value: 'asc', label: words.ascending, icon: 'arrow-up' },
							{ value: 'desc', label: words.descending, icon: 'arrow-down' }
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
						{words.filtered(
							fields.find((field) => field.id === config.filter?.field)?.name ?? '',
							config.filter.text
						)}
					</span>
					<Button variant="ghost" onclick={() => (config.filter = null)}>{words.clearFilter}</Button
					>
				</div>
			{/if}
			<fieldset class="flex flex-col gap-1">
				<legend class={legend}>{words.fieldsShown}</legend>
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
				<legend class={legend}>{words.fieldsToFill}</legend>
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
				<legend class={legend}>{words.lastTimeMatches}</legend>
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
			<Field label={words.groupBy}>
				<Select
					options={[
						{ value: 'auto', label: words.automaticGroup(autoLayout.group?.name ?? null) },
						{ value: '', label: words.nothing },
						...fieldOptions(fields)
					]}
					value={config.group === undefined ? 'auto' : (config.group ?? '')}
					onchange={setGroup}
				/>
			</Field>
			<Field label={words.title}>
				<Select
					options={[
						{
							value: '',
							label: words.automaticTitle(
								listLayout(fields, { ...config, title: undefined }).title?.name ?? null
							)
						},
						...fieldOptions(fields)
					]}
					value={config.title ?? ''}
					onchange={(title) => (config.title = title || null)}
				/>
			</Field>
			<fieldset class="flex flex-col gap-1">
				<legend class={legend}>{words.fieldsUnderTitle}</legend>
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
				{#each [{ id: 'bar', label: words.bars }, { id: 'line', label: words.line }] as option (option.id)}
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
			<Field label={words.xAxis}>
				<Select
					options={fieldOptions(fields)}
					value={axis ?? ''}
					onchange={(x) => setChart('x', x || null)}
				/>
			</Field>
			{#if isDated(xField?.type ?? 'text')}
				<Field label={words.groupDatesBy}>
					<Select
						options={[
							{ value: 'day', label: words.day },
							{ value: 'week', label: words.week },
							{ value: 'month', label: words.month }
						]}
						value={config.bucket ?? 'day'}
						onchange={(bucket) => setChart('bucket', bucket)}
					/>
				</Field>
			{/if}
			<div class="grid grid-cols-2 gap-3">
				<Field label={words.calculation}>
					<Select
						options={[
							{ value: 'count', label: words.aggregates.count },
							{ value: 'sum', label: words.aggregates.sum },
							{ value: 'avg', label: words.aggregates.avg },
							{ value: 'max', label: words.aggregates.max },
							{ value: 'min', label: words.aggregates.min }
						]}
						value={config.agg ?? 'count'}
						onchange={setAgg}
					/>
				</Field>
				<Field label={words.of}>
					<Select
						options={fieldOptions(numeric)}
						value={config.y ?? ''}
						disabled={(config.agg ?? 'count') === 'count'}
						onchange={(y) => setChart('y', y || null)}
					/>
				</Field>
			</div>
			<Field label={words.colourBy}>
				<Select
					options={[{ value: '', label: words.oneSeries }, ...fieldOptions(choices)]}
					value={config.color ?? ''}
					onchange={(color) => setChart('color', color || null)}
				/>
			</Field>
			{#if (config.kind ?? 'bar') === 'line' && isDated(xField?.type ?? 'text')}
				<Field label={words.rollingDays}>
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
		<Button variant="ghost" onclick={remove}>{common.delete}</Button>
		<div class="flex-1"></div>
		<Button variant="primary" onclick={save}>{common.save}</Button>
	{/snippet}
</Dialog>
