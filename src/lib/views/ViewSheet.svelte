<script lang="ts">
	import { untrack } from 'svelte';

	import { goto } from '$app/navigation';

	import { app } from '#lib/client/app.svelte.ts';
	import { tableUrl } from '#lib/client/nav.ts';
	import { applyWithUndo, showToast } from '#lib/client/toast.svelte.ts';
	import {
		chartSetup,
		defaultMatch,
		deleteRecords,
		entryFields,
		listLayout,
		updateRecord
	} from '#lib/core/actions.ts';
	import type {
		ChartConfig,
		FieldDef,
		SortKey,
		Value,
		ViewConfig,
		ViewType
	} from '#lib/core/model.ts';
	import { isDated, isNumeric, sortsOf } from '#lib/core/model.ts';
	import { common } from '#lib/i18n/common.ts';
	import { views as words } from '#lib/i18n/views.ts';
	import Button from '#lib/ui/Button.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import Field from '#lib/ui/Field.svelte';
	import { fieldIcon } from '#lib/ui/field-icons.ts';
	import Icon from '#lib/ui/Icon.svelte';
	import IconButton from '#lib/ui/IconButton.svelte';
	import Select, { type Option } from '#lib/ui/Select.svelte';
	import { checkbox, focus, input, legend } from '#lib/ui/styles.ts';

	import { conditionText } from './rules.ts';
	import { VIEW_TYPES, viewLabel } from './views.ts';

	let {
		open = $bindable(false),
		tableId,
		viewId
	}: { open?: boolean; tableId: string; viewId: string } = $props();

	const existing = $derived.by(() => {
		void app.version;
		return app.ws.view(viewId);
	});

	const fields = $derived.by(() => {
		void app.version;
		return app.ws.fields(tableId);
	});

	const type = $derived<ViewType>(existing?.type ?? 'grid');
	const config = $derived<ViewConfig>(existing?.config ?? {});

	let draft = $state<string | null>(null);

	function commit(set: { name?: string; type?: ViewType; config?: ViewConfig }): void {
		if (existing === undefined) return;
		const label = set.name ?? existing.name;
		const record: Record<string, Value> = { ...set };
		if (set.config !== undefined) record.config = JSON.parse(JSON.stringify(set.config)) as Value;
		applyWithUndo(updateRecord(app.ws, existing.id, record), words.viewChanged(label));
	}

	function edit(change: (next: ViewConfig) => void): void {
		const next = structuredClone($state.snapshot(config)) as ViewConfig;
		change(next);
		commit({ config: next });
	}

	function rename(): void {
		if (draft === null || existing === undefined) return;
		const label = draft.trim() || viewLabel(type);
		draft = null;
		if (label !== existing.name) commit({ name: label });
	}

	$effect(() => {
		if (!open) untrack(rename);
	});

	function pickType(next: ViewType): void {
		if (existing === undefined || next === type) return;
		commit(
			existing.name === viewLabel(type) ? { type: next, name: viewLabel(next) } : { type: next }
		);
	}

	function toggle(
		key: 'hidden' | 'fields' | 'match' | 'show',
		id: string,
		fallback: string[]
	): void {
		edit((next) => {
			const list = next[key] ?? fallback;
			const toggled = list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
			const at = (item: string): number => fields.findIndex((field) => field.id === item);
			next[key] = key === 'match' ? toggled.sort((a, b) => at(a) - at(b)) : toggled;
		});
	}

	const fillable = $derived(fields.filter((field) => field.type !== 'formula'));
	const fillIn = $derived(entryFields(fields, config).map((field) => field.id));
	const keyCandidates = $derived(
		fillable.filter(
			(field) => field.type === 'choice' || field.type === 'link' || field.type === 'text'
		)
	);
	const fallbackMatch = $derived.by(() => {
		void app.version;
		return defaultMatch(entryFields(fields, config), app.ws.rows(tableId));
	});
	const numeric = $derived(
		fields.filter((field) => isNumeric(field.type) || field.type === 'formula')
	);
	const choices = $derived(fields.filter((field) => field.type === 'choice'));
	// An image can't be grouped on, titled by or charted.
	const shown = $derived(fields.filter((field) => field.type !== 'image'));
	const images = $derived(fields.filter((field) => field.type === 'image'));
	const layout = $derived(listLayout(fields, config));
	const autoLayout = $derived(
		listLayout(fields, { ...config, group: undefined, title: undefined })
	);
	const fieldOptions = (list: FieldDef[]): Option[] =>
		list.map((field) => ({ value: field.id, label: field.name, icon: fieldIcon(field.type) }));

	const chart = $derived.by(() => {
		void app.version;
		return chartSetup(fields, config, app.ws.rows(tableId));
	});
	const xField = $derived(fields.find((field) => field.id === chart.x));

	function setChart<K extends keyof ChartConfig>(key: K, value: ChartConfig[K]): void {
		edit((next) => {
			next[key] = value as ViewConfig[K];
		});
	}

	function setAgg(agg: ChartConfig['agg']): void {
		edit((next) => {
			next.agg = agg;
			if (agg !== 'count' && !chart.y) next.y = numeric[0]?.id ?? null;
		});
	}

	const sortKeys = $derived(sortsOf(config));

	/** Sets, adds (at the end) or removes (with null) the sort key at `at`. */
	function setSort(at: number, key: SortKey | null): void {
		const keys = [...sortKeys];
		if (key === null) keys.splice(at, 1);
		else keys[at] = key;
		edit((next) => {
			next.sort = keys.length === 0 ? null : keys;
		});
	}

	function setGroup(value: string): void {
		edit((next) => {
			if (value === 'auto') delete next.group;
			else next.group = value || null;
		});
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

<Dialog bind:open title={words.viewSettings} onsubmit={() => (open = false)}>
	<div class="flex flex-col gap-3">
		<Field label={words.name}>
			<input
				class={input}
				value={draft ?? existing?.name ?? ''}
				placeholder={viewLabel(type)}
				oninput={(event) => (draft = event.currentTarget.value)}
				onchange={rename}
			/>
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
			<fieldset class="flex flex-col gap-2">
				<legend class={legend}>{words.sortBy}</legend>
				{#each sortKeys as key, at (key.field)}
					<div class="flex gap-2">
						<Select
							class="flex-1"
							aria-label={words.sortField(at + 1)}
							options={fieldOptions(
								fields.filter(
									(field) =>
										field.id === key.field || !sortKeys.some((other) => other.field === field.id)
								)
							)}
							value={key.field}
							onchange={(field) => setSort(at, { field, dir: key.dir })}
						/>
						<Select
							class="w-40 max-sm:w-32"
							aria-label={words.order}
							options={[
								{ value: 'asc', label: words.ascending, icon: 'arrow-up' },
								{ value: 'desc', label: words.descending, icon: 'arrow-down' }
							]}
							value={key.dir}
							onchange={(dir) => setSort(at, { field: key.field, dir })}
						/>
						<IconButton icon="x" label={words.removeSort} onclick={() => setSort(at, null)} />
					</div>
				{/each}
				{#if sortKeys.length < fields.length}
					{#key sortKeys.length}
						<Select
							aria-label={words.addSort}
							placeholder={sortKeys.length === 0 ? words.unsorted : words.thenBy}
							options={fieldOptions(
								fields.filter((field) => !sortKeys.some((key) => key.field === field.id))
							)}
							value=""
							onchange={(field) => setSort(sortKeys.length, { field, dir: 'asc' })}
						/>
					{/key}
				{/if}
			</fieldset>
			<Field label={words.rowHeight}>
				<Select
					options={[
						{ value: 'normal', label: words.rowsNormal },
						{ value: 'tall', label: words.rowsTall }
					]}
					value={config.tall === true ? 'tall' : 'normal'}
					onchange={(height) =>
						edit((next) => {
							if (height === 'tall') next.tall = true;
							else delete next.tall;
						})}
				/>
			</Field>
			{#if (config.filters ?? []).length > 0}
				<div class="flex items-center gap-2">
					<span class="min-w-0 flex-1 truncate">
						{(config.filters ?? []).map((item) => conditionText(app.ws, tableId, item)).join(', ')}
					</span>
					<Button variant="ghost" onclick={() => edit((next) => (next.filters = []))}
						>{words.clearFilter}</Button
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
						...fieldOptions(shown)
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
						...fieldOptions(shown)
					]}
					value={config.title ?? ''}
					onchange={(title) => edit((next) => (next.title = title || null))}
				/>
			</Field>
			{#if images.length > 0}
				<Field label={words.cover}>
					<Select
						options={[{ value: '', label: words.nothing }, ...fieldOptions(images)]}
						value={layout.cover?.id ?? ''}
						onchange={(cover) => edit((next) => (next.cover = cover || null))}
					/>
				</Field>
			{/if}
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
						class="h-control rounded-box font-medium transition-colors motion {chart.kind ===
						option.id
							? 'bg-fill text-on-fill'
							: 'bg-tint hover:bg-tint-2'}"
						onclick={() => setChart('kind', option.id as 'bar' | 'line')}>{option.label}</button
					>
				{/each}
			</div>
			<Field label={words.xAxis}>
				<Select
					options={fieldOptions(shown)}
					value={chart.x ?? ''}
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
						value={chart.bucket ?? 'day'}
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
						value={chart.agg ?? 'count'}
						onchange={setAgg}
					/>
				</Field>
				<Field label={words.of}>
					<Select
						options={fieldOptions(numeric)}
						value={chart.y ?? ''}
						disabled={chart.agg === 'count'}
						onchange={(y) => setChart('y', y || null)}
					/>
				</Field>
			</div>
			<Field label={words.colourBy}>
				<Select
					options={[{ value: '', label: words.oneSeries }, ...fieldOptions(choices)]}
					value={chart.color ?? ''}
					onchange={(color) => setChart('color', color || null)}
				/>
			</Field>
			{#if chart.kind === 'line' && isDated(xField?.type ?? 'text')}
				<Field label={words.rollingDays}>
					<input
						class={input}
						inputmode="numeric"
						placeholder="7"
						value={chart.rolling ?? ''}
						onchange={(event) => {
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
	{/snippet}
</Dialog>
