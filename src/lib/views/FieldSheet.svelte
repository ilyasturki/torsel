<script lang="ts">
	import { untrack } from 'svelte';

	import { app } from '#lib/client/app.svelte.ts';
	import { currencyFor, formatNumber, formatValue, readNumber } from '#lib/client/format.ts';
	import { readFormula } from '#lib/client/formula.ts';
	import { applyWithUndo, showToast } from '#lib/client/toast.svelte.ts';
	import { addField, deleteRecords, reorder, shifted, updateRecord } from '#lib/core/actions.ts';
	import { nameTaken } from '#lib/core/names.ts';
	import { toDisplay } from '#lib/core/formula.ts';
	import type {
		Change,
		Choice,
		DateStyleName,
		FieldDef,
		FieldType,
		FormatKey,
		ResultType,
		Value
	} from '#lib/core/model.ts';
	import { DATE_STYLES, RESULT_TYPES, formatSet, hasChoices, isDated } from '#lib/core/model.ts';
	import { retypeField } from '#lib/core/retype.ts';
	import { CURRENCIES, currencyOf, ratingScale, todayIso } from '#lib/core/values.ts';
	import { common } from '#lib/i18n/common.ts';
	import { fields as words } from '#lib/i18n/fields.ts';
	import Button from '#lib/ui/Button.svelte';
	import { DATA_COLORS, swatch } from '#lib/ui/colors.ts';
	import Field from '#lib/ui/Field.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import IconButton from '#lib/ui/IconButton.svelte';
	import Select from '#lib/ui/Select.svelte';
	import { checkbox, input, textarea } from '#lib/ui/styles.ts';

	import { typeLabel, typeOptions } from './field-types.ts';

	let {
		open = $bindable(false),
		tableId,
		fieldId = null,
		preset = null,
		onCloseAutoFocus
	}: {
		open?: boolean;
		tableId: string;
		fieldId?: string | null;
		preset?: { name: string; type: FieldType; at?: number } | null;
		onCloseAutoFocus?: (event: Event) => void;
	} = $props();

	const TYPES = typeOptions();
	const AUTO = 'auto';
	const DECIMALS = [
		{ value: AUTO, label: words.auto },
		...['0', '1', '2', '3', '4'].map((value) => ({ value, label: value }))
	];
	const names = new Intl.DisplayNames(undefined, { type: 'currency' });
	const MONEY = CURRENCIES.map((code) => ({ value: code, label: `${names.of(code)} (${code})` }));
	const LOWEST = ['0', '1'].map((value) => ({ value, label: value }));
	const HIGHEST = ['3', '4', '5', '6', '7', '8', '9', '10'].map((value) => ({
		value,
		label: value
	}));
	const LOOKS = DATE_STYLES.map((value) => ({
		value,
		label: formatValue({ type: 'date', dateStyle: value }, todayIso())
	}));
	const RESULTS: { value: ResultType | typeof AUTO; label: string }[] = [
		{ value: AUTO, label: words.auto },
		...RESULT_TYPES.map((value) => ({ value, label: words.types[value] }))
	];
	const CLOCKS = [
		{ value: 'minutes', label: 'h:mm' },
		{ value: 'seconds', label: 'h:mm:ss' }
	];

	let name = $state('');
	let type = $state<FieldType>('text');
	let choices = $state<Choice[]>([]);
	let target = $state('');
	let formula = $state('');
	let description = $state('');
	let step = $state('');
	let decimals = $state(AUTO);
	let grouping = $state(true);
	let unit = $state('');
	let currency = $state('EUR');
	let lowest = $state('1');
	let highest = $state('5');
	let half = $state(false);
	let clock = $state('minutes');
	let look = $state<DateStyleName>('short');
	let result = $state<ResultType | typeof AUTO>(AUTO);
	let newChoice = $state('');
	let problem = $state('');
	let start = $state('');

	const snapshot = (): string =>
		JSON.stringify({
			name,
			type,
			choices,
			target,
			formula,
			description,
			format: format()
		});

	function format(): Partial<Pick<FieldDef, FormatKey>> {
		const stepValue = readNumber(step);
		const options: Partial<Pick<FieldDef, FormatKey>> = {
			decimals: decimals === AUTO ? null : Number(decimals),
			grouping: grouping ? undefined : false,
			unit: unit.trim() || null,
			currency,
			min: Number(lowest),
			max: Number(highest),
			step:
				type === 'rating'
					? half
						? 0.5
						: null
					: stepValue !== null && stepValue > 0
						? stepValue
						: null,
			seconds: clock === 'seconds' ? true : undefined,
			dateStyle: look === 'short' ? null : look,
			result: result === AUTO ? null : result
		};
		if (type === 'formula') {
			if (result !== 'number' && result !== 'percent') options.decimals = null;
			if (result !== 'currency') options.currency = null;
			if (result !== 'date') options.dateStyle = null;
		}
		return formatSet(type, options) as Partial<Pick<FieldDef, FormatKey>>;
	}
	const existing = $derived.by(() => {
		void app.version;
		return fieldId === null ? undefined : app.ws.field(fieldId);
	});
	const dirty = $derived(
		open && existing === undefined && (snapshot() !== start || newChoice.trim() !== '')
	);

	const tables = $derived.by(() => {
		void app.version;
		const table = app.ws.table(tableId);
		return table === undefined ? [] : app.ws.tables(table.base);
	});

	const siblings = $derived.by(() => {
		void app.version;
		return app.ws.fields(tableId).map((field) => field.id);
	});

	function rescaled(): boolean {
		if (existing === undefined || type !== 'rating' || existing.type !== 'rating') return false;
		const before = ratingScale(existing);
		const after = ratingScale(format());
		return before.min !== after.min || before.max !== after.max || before.step !== after.step;
	}

	function conversion(expr: string | null = null): { changes: Change[]; lost: number } | null {
		return existing === undefined || (type === existing.type && !rescaled())
			? null
			: retypeField(
					app.ws,
					existing.id,
					{
						type,
						target: target || null,
						expr,
						choices: $state.snapshot(choices),
						checkWords: { yes: words.yes, no: words.no },
						...format()
					},
					existing.type === 'formula' ? app.computed(tableId) : undefined
				);
	}

	const retypeHint = $derived.by(() => {
		void app.version;
		const result = open ? conversion() : null;
		if (result === null) return undefined;
		if (type === 'formula') return words.formulaTakesOver;
		if (type === 'link' && target === '') return words.pickLinkTable;
		if (result.lost === 0) return existing?.type === type ? undefined : words.allCarryOver;
		return words.valuesLost(result.lost, typeLabel(type));
	});

	$effect(() => {
		if (open) {
			const field = fieldId === null ? undefined : app.ws.field(fieldId);
			const wanted = untrack(() => preset);
			name = field?.name ?? wanted?.name ?? '';
			type = wanted?.type ?? field?.type ?? 'text';
			choices = field?.choices.map((choice) => ({ ...choice })) ?? [];
			target = field?.target ?? '';
			formula = field?.expr ? toDisplay(field.expr, app.ws.fields(tableId)) : '';
			description = field?.description ?? '';
			step = field?.type === 'number' && field.step ? formatNumber(field.step, { edit: true }) : '';
			decimals = field?.decimals == null ? AUTO : String(field.decimals);
			grouping = field?.grouping ?? true;
			unit = field?.unit ?? '';
			currency =
				field?.type === 'currency' || field?.currency
					? currencyOf(field)
					: currencyFor(app.ws, tableId);
			const scale = ratingScale(field ?? {});
			lowest = String(scale.min);
			highest = String(scale.max);
			half = field?.type === 'rating' && scale.step === 0.5;
			clock = field?.seconds ? 'seconds' : 'minutes';
			look = field?.dateStyle ?? 'short';
			result = field?.result ?? AUTO;
			newChoice = '';
			problem = '';
			start = untrack(snapshot);
		}
	});

	function pickType(next: FieldType): void {
		type = next;
		if (hasChoices(next) && existing !== undefined && !hasChoices(existing.type)) {
			const found = conversion()?.changes[0].set.choices;
			choices = Array.isArray(found) ? (found as Choice[]) : [];
		}
	}

	function addChoice(): void {
		const value = newChoice.trim();
		if (value !== '' && !choices.some((choice) => choice.name === value)) {
			choices.push({ name: value, color: DATA_COLORS[(choices.length % 7) + 1] });
		}
		newChoice = '';
	}

	function cycleColor(index: number): void {
		const current = DATA_COLORS.indexOf(
			(choices[index].color ?? 'gray') as (typeof DATA_COLORS)[number]
		);
		choices[index].color = DATA_COLORS[(current + 1) % DATA_COLORS.length];
	}

	function settled(): {
		set: Record<string, Value>;
		retyped: ReturnType<typeof conversion>;
	} | null {
		problem = '';
		if (name.trim() === '') {
			problem = words.nameNeeded;
			return null;
		}
		const holder = nameTaken(app.ws.fields(tableId), name, existing?.id);
		if (holder !== undefined) {
			problem = words.nameTaken(holder.name);
			return null;
		}
		if (type === 'link' && target === '') {
			if (existing === undefined) problem = words.pickLinkTable;
			return null;
		}

		let expr: string | null = null;
		if (type === 'formula') {
			const read = readFormula(tableId, fieldId, formula);
			if ('problem' in read) {
				problem = read.problem;
				return null;
			}
			expr = read.expr;
		}

		const set: Record<string, Value> = {
			name: name.trim(),
			description: description.trim() === '' ? null : description.trim(),
			...format()
		};
		const retyped = conversion(expr);
		if (retyped === null) {
			if (hasChoices(type))
				set.choices = choices.map((choice) => ({ name: choice.name, color: choice.color }));
			if (type === 'link') set.target = target || null;
			if (type === 'formula') set.expr = expr;
		}
		return { set, retyped };
	}

	function save(): void {
		const ready = settled();
		if (ready === null) return;
		const [made, ...moves] = addField(
			app.ws,
			tableId,
			{ name: name.trim(), type },
			preset?.at
		).changes;
		applyWithUndo(
			[{ ...made, set: { ...made.set, ...ready.set } }, ...moves],
			words.added(name.trim())
		);
		open = false;
	}

	function apply(): void {
		if (existing === undefined || snapshot() === start) return;
		const ready = settled();
		if (ready === null) return;
		const label = name.trim();
		const lost = ready.retyped?.lost ?? 0;
		applyWithUndo(
			[...(ready.retyped?.changes ?? []), ...updateRecord(app.ws, existing.id, ready.set)],
			lost === 0 ? words.changed(label) : words.retypedLosing(label, lost)
		);
		start = snapshot();
	}

	let shown = false;
	$effect(() => {
		if (open) {
			shown = true;
		} else if (shown) {
			shown = false;
			untrack(apply);
		}
	});

	const picked = $derived(
		JSON.stringify([
			type,
			choices,
			target,
			decimals,
			grouping,
			currency,
			lowest,
			highest,
			half,
			clock,
			look,
			result
		])
	);
	$effect(() => {
		void picked;
		if (open) untrack(apply);
	});

	function submit(): void {
		if (existing === undefined) {
			save();
			return;
		}
		apply();
		if (problem === '') open = false;
	}

	function remove(): void {
		if (existing === undefined) {
			return;
		}
		const label = words.deleted(existing.name);
		const group = app.apply(deleteRecords(app.ws, [existing.id]), label);
		showToast(label, group?.id ?? null);
		open = false;
	}

	function move(by: number): void {
		if (existing !== undefined) {
			applyWithUndo(
				reorder(app.ws, shifted(siblings, existing.id, by)),
				words.moved(existing.name)
			);
		}
	}
</script>

<Dialog
	bind:open
	title={existing === undefined ? words.newField : words.field}
	{dirty}
	onsubmit={submit}
	{onCloseAutoFocus}
>
	<div class="flex flex-col gap-3">
		<Field label={words.name}>
			<input class={input} bind:value={name} placeholder={words.namePlaceholder} onblur={apply} />
		</Field>

		<Field label={words.type} hint={retypeHint}>
			<Select options={TYPES} value={type} onchange={pickType} />
		</Field>

		{#if hasChoices(type)}
			<div class="flex flex-col gap-2">
				<span class="text-sm font-medium text-ink-2">{words.choiceList}</span>
				<div class="flex flex-wrap gap-1">
					{#each choices as choice, index (choice.name)}
						<span class="inline-flex h-control items-center rounded-box bg-tint">
							<button
								type="button"
								class="flex h-full items-center gap-2 pl-3 font-medium"
								onclick={() => cycleColor(index)}
							>
								<span class="size-mark rounded-box" style={swatch(choice.color)}
								></span>{choice.name}
							</button>
							<button
								type="button"
								class="flex h-full w-control items-center justify-center text-ink-2 hover:text-ink"
								aria-label={words.removeChoice(choice.name)}
								onclick={() => choices.splice(index, 1)}
							>
								<Icon name="x" class="size-3" />
							</button>
						</span>
					{/each}
				</div>
				<div class="flex gap-2">
					<input
						class={input}
						bind:value={newChoice}
						placeholder={words.addChoice}
						aria-label={words.addChoice}
						onkeydown={(event) => {
							if (event.key === 'Enter' && newChoice.trim() !== '') {
								event.preventDefault();
								addChoice();
							}
						}}
					/>
					<IconButton
						icon="plus"
						label={words.addThisChoice}
						variant="secondary"
						onclick={addChoice}
					/>
				</div>
			</div>
		{/if}

		{#if type === 'link'}
			<Field label={words.linkedTable}>
				<Select
					options={tables.map((table) => ({ value: table.id, label: table.name }))}
					bind:value={target}
					placeholder={words.pickTable}
					disabled={existing?.type === 'link'}
				/>
			</Field>
		{/if}

		{#if type === 'formula'}
			<Field label={words.formula}>
				<textarea
					class="{textarea} h-24"
					bind:value={formula}
					spellcheck="false"
					placeholder={words.formulaExample}
					onblur={apply}></textarea>
			</Field>
		{/if}

		{#if type === 'number'}
			<div class="grid grid-cols-3 gap-2">
				<Field label={words.decimals}>
					<Select options={DECIMALS} bind:value={decimals} />
				</Field>
				<Field label={words.unit}>
					<input class={input} bind:value={unit} placeholder="kg" onblur={apply} />
				</Field>
				<Field label={words.step}>
					<input
						class={input}
						inputmode="decimal"
						bind:value={step}
						placeholder="1"
						onblur={apply}
					/>
				</Field>
			</div>
			<label class="flex items-center gap-2">
				<input type="checkbox" class={checkbox} bind:checked={grouping} />
				{words.groupThousands}
			</label>
		{:else if type === 'currency'}
			<div class="grid grid-cols-3 gap-2">
				<div class="col-span-2">
					<Field label={words.currency}>
						<Select options={MONEY} bind:value={currency} />
					</Field>
				</div>
				<Field label={words.decimals}>
					<Select options={DECIMALS} bind:value={decimals} />
				</Field>
			</div>
		{:else if type === 'percent'}
			<div class="grid grid-cols-3 gap-2">
				<Field label={words.decimals}>
					<Select options={DECIMALS} bind:value={decimals} />
				</Field>
			</div>
		{:else if type === 'rating'}
			<div class="grid grid-cols-3 gap-2">
				<Field label={words.lowest}>
					<Select options={LOWEST} bind:value={lowest} />
				</Field>
				<Field label={words.highest}>
					<Select options={HIGHEST} bind:value={highest} />
				</Field>
			</div>
			<label class="flex items-center gap-2">
				<input type="checkbox" class={checkbox} bind:checked={half} />
				{words.halfPoints}
			</label>
		{:else if type === 'duration'}
			<div class="grid grid-cols-3 gap-2">
				<Field label={words.format}>
					<Select options={CLOCKS} bind:value={clock} />
				</Field>
			</div>
		{:else if isDated(type)}
			<div class="grid grid-cols-3 gap-2">
				<div class="col-span-2">
					<Field label={words.format}>
						<Select options={LOOKS} bind:value={look} />
					</Field>
				</div>
			</div>
		{:else if type === 'formula'}
			<div class="grid grid-cols-3 gap-2">
				<Field label={words.shownAs}>
					<Select options={RESULTS} bind:value={result} />
				</Field>
				{#if result === 'number' || result === 'percent'}
					<Field label={words.decimals}>
						<Select options={DECIMALS} bind:value={decimals} />
					</Field>
				{:else if result === 'currency'}
					<div class="col-span-2">
						<Field label={words.currency}>
							<Select options={MONEY} bind:value={currency} />
						</Field>
					</div>
				{:else if result === 'date'}
					<div class="col-span-2">
						<Field label={words.format}>
							<Select options={LOOKS} bind:value={look} />
						</Field>
					</div>
				{/if}
			</div>
		{/if}

		<Field label={words.description}>
			<input class={input} bind:value={description} onblur={apply} />
		</Field>

		{#if problem}
			<p class="rounded-box bg-tint p-2" role="alert">{problem}</p>
		{/if}
	</div>

	{#snippet footer()}
		{#if existing !== undefined}
			<Button variant="ghost" onclick={remove}>{common.delete}</Button>
			<IconButton
				icon="arrow-left"
				label={words.moveLeft}
				disabled={siblings[0] === existing.id}
				onclick={() => move(-1)}
			/>
			<IconButton
				icon="arrow-right"
				label={words.moveRight}
				disabled={siblings.at(-1) === existing.id}
				onclick={() => move(1)}
			/>
		{/if}
		{#if existing === undefined}
			<div class="flex-1"></div>
			<Button variant="primary" onclick={save}>{common.save}</Button>
		{/if}
	{/snippet}
</Dialog>
