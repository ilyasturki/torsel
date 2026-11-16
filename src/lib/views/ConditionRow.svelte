<script lang="ts">
	import { app } from '#lib/client/app.svelte.ts';
	import { editText, readValue } from '#lib/client/format.ts';
	import type { Condition, Op } from '#lib/core/conditions.ts';
	import { OPS_OF, RELATIVE_DAYS, arity, kindOf } from '#lib/core/conditions.ts';
	import { namesIn, scopeOf, toDisplay, toStored } from '#lib/core/formula.ts';
	import type { FieldDef, Value } from '#lib/core/model.ts';
	import { todayIso } from '#lib/core/values.ts';
	import { rules as words } from '#lib/i18n/rules.ts';
	import ChipPicker from '#lib/ui/ChipPicker.svelte';
	import { fieldIcon } from '#lib/ui/field-icons.ts';
	import IconButton from '#lib/ui/IconButton.svelte';
	import Select from '#lib/ui/Select.svelte';
	import { input } from '#lib/ui/styles.ts';

	import DateInput from './DateInput.svelte';
	import FormulaInput from './FormulaInput.svelte';

	let {
		tableId,
		condition,
		onchange,
		onremove,
		removeLabel = words.removeCondition
	}: {
		tableId: string;
		condition: Condition;
		onchange: (next: Condition) => void;
		onremove: () => void;
		removeLabel?: string;
	} = $props();

	const FORMULA = '';
	const EXACT = 'exact';

	const fields = $derived.by(() => {
		void app.version;
		return app.ws.fields(tableId);
	});

	const field = $derived(
		condition.field === null ? undefined : fields.find((item) => item.id === condition.field)
	);
	const kind = $derived(field === undefined ? null : kindOf(field));
	const shape = $derived(arity(condition.op));

	const fieldOptions = $derived([
		...fields.map((item) => ({ value: item.id, label: item.name, icon: fieldIcon(item.type) })),
		{ value: FORMULA, label: words.customFormula, icon: 'formula' as const }
	]);

	const opOptions = $derived(
		kind === null
			? []
			: [...OPS_OF[kind], ...(OPS_OF[kind].includes(condition.op) ? [] : [condition.op])].map(
					(op) => ({ value: op, label: words.ops[op] })
				)
	);

	function pickField(id: string): void {
		if (id === FORMULA) {
			onchange({ field: null, op: 'formula', value: '' });
			return;
		}
		const next = fields.find((item) => item.id === id);
		if (next === undefined) return;
		onchange({ field: id, op: OPS_OF[kindOf(next)][0] });
	}

	function pickOp(op: Op): void {
		const keeps = arity(op) === shape && op !== 'formula';
		onchange(keeps ? { ...condition, op } : { field: condition.field, op });
	}

	function setValue(value: Value | undefined): void {
		onchange(
			value === undefined ? { field: condition.field, op: condition.op } : { ...condition, value }
		);
	}

	const values = $derived(
		condition.value === undefined
			? []
			: Array.isArray(condition.value)
				? condition.value
				: [condition.value]
	);

	function textOf(at: number): string {
		const value = values[at];
		if (value === undefined || value === null) return '';
		if (kind === 'number' && typeof value === 'number' && field !== undefined)
			return editText(field, value);
		return String(value);
	}

	function typed(at: number, text: string): void {
		let value: Value = text;
		if (kind === 'number' && field !== undefined) {
			const read = readValue(field, text);
			value = typeof read === 'number' ? read : text.trim() === '' ? '' : text;
		}
		if (shape === 'two') {
			const both = [values[0] ?? '', values[1] ?? ''] as Value[];
			both[at] = value;
			setValue(both);
		} else setValue(value === '' ? undefined : value);
	}

	const listOptions = $derived.by(() => {
		if (field === undefined) return [];
		if (kind === 'link') {
			void app.version;
			return app.ws
				.rows(field.target ?? '')
				.map((row) => ({ name: app.ws.rowTitle(row.id), color: null, id: row.id }));
		}
		return field.choices.map((choice) => ({ ...choice, id: choice.name }));
	});

	const listValue = $derived(
		values.map((id) => listOptions.find((option) => option.id === id)?.name ?? String(id))
	);

	function pickList(names: string[]): void {
		const ids = names.map((name) => listOptions.find((option) => option.name === name)?.id ?? name);
		setValue(ids.length === 0 ? undefined : ids);
	}

	const dayOptions = $derived([
		...RELATIVE_DAYS.map((day) => ({ value: day, label: words.days[day] })),
		{ value: EXACT, label: words.exactDate }
	]);

	function dayChoice(at: number): string {
		const value = values[at];
		if (typeof value !== 'string') return '';
		return (RELATIVE_DAYS as readonly string[]).includes(value) ? value : EXACT;
	}

	function pickDay(at: number, choice: string): void {
		const day = choice === EXACT ? todayIso() : choice;
		if (shape === 'two') {
			const both = [values[0] ?? day, values[1] ?? day] as Value[];
			both[at] = day;
			setValue(both);
		} else setValue(day);
	}

	function setDay(at: number, value: Value | undefined): void {
		if (typeof value !== 'string' || value === '') return;
		if (shape === 'two') {
			const both = [values[0] ?? value, values[1] ?? value] as Value[];
			both[at] = value;
			setValue(both);
		} else setValue(value);
	}

	const base = $derived(app.ws.table(tableId)?.base ?? '');
	let formula = $state('');
	let shownFormula = $state<string | null>(null);

	$effect(() => {
		const stored = condition.op === 'formula' ? String(condition.value ?? '') : '';
		if (stored !== shownFormula) {
			shownFormula = stored;
			formula = stored === '' ? '' : toDisplay(stored, namesIn(app.ws, base));
		}
	});

	function settleFormula(): void {
		let stored: string;
		try {
			stored = toStored(formula, scopeOf(app.ws, tableId));
		} catch {
			return;
		}
		if (stored !== shownFormula) {
			shownFormula = stored;
			setValue(stored);
		}
	}

	const dateField: Pick<FieldDef, 'type'> = { type: 'date' };
</script>

<div
	class="flex items-start gap-2 max-sm:flex-wrap max-sm:rounded-box max-sm:bg-tint max-sm:p-2"
	data-condition
>
	<Select
		class="w-36 shrink-0 max-sm:min-w-0 max-sm:flex-1"
		aria-label={words.field}
		options={fieldOptions}
		value={condition.op === 'formula' ? FORMULA : (condition.field ?? '')}
		onchange={pickField}
	/>
	{#if condition.op !== 'formula'}
		<Select
			class="w-48 shrink-0 max-sm:min-w-0 max-sm:flex-1"
			aria-label={words.operator}
			options={opOptions}
			value={condition.op}
			onchange={pickOp}
		/>
	{/if}
	<div class="flex min-w-0 flex-1 gap-2 max-sm:order-last max-sm:basis-full">
		{#if condition.op === 'formula'}
			<div class="min-w-0 flex-1">
				<FormulaInput
					bind:value={formula}
					{tableId}
					fieldId={null}
					label={words.customFormula}
					placeholder={words.customFormula}
					onblur={settleFormula}
					onkeydown={(event) => {
						if (event.key === 'Enter' && !event.shiftKey) {
							event.preventDefault();
							settleFormula();
						}
					}}
				/>
			</div>
		{:else if shape === 'list'}
			<div class="min-w-0 flex-1">
				<ChipPicker
					label={field?.name ?? words.value}
					options={listOptions}
					value={listValue}
					onchange={pickList}
				/>
			</div>
		{:else if shape !== 'none' && kind === 'date'}
			<div class="flex min-w-0 flex-1 flex-col gap-2">
				{#each shape === 'two' ? [0, 1] : [0] as at (at)}
					<div class="flex min-w-0 flex-col gap-2">
						<Select
							class="w-full"
							aria-label={shape === 'two' ? (at === 0 ? words.from : words.to) : words.value}
							placeholder={words.value}
							options={dayOptions}
							value={dayChoice(at)}
							onchange={(choice) => pickDay(at, choice)}
						/>
						{#if dayChoice(at) === EXACT}
							<div class="min-w-0">
								<DateInput
									field={dateField}
									label={words.exactDate}
									bind:value={() => values[at] ?? null, (value) => setDay(at, value)}
								/>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{:else if shape !== 'none'}
			{#each shape === 'two' ? [0, 1] : [0] as at (at)}
				<input
					class="{input} min-w-0 flex-1"
					aria-label={shape === 'two' ? (at === 0 ? words.from : words.to) : words.value}
					placeholder={shape === 'two' ? (at === 0 ? words.from : words.to) : words.value}
					inputmode={kind === 'number' ? 'decimal' : undefined}
					value={textOf(at)}
					onchange={(event) => typed(at, event.currentTarget.value)}
				/>
			{/each}
		{/if}
	</div>
	<IconButton icon="x" label={removeLabel} onclick={onremove} />
</div>
