<script lang="ts">
	import { untrack } from 'svelte';

	import { app } from '#lib/client/app.svelte.ts';
	import { formatNumber, localCurrency, readNumber } from '#lib/client/format.ts';
	import { readFormula } from '#lib/client/formula.ts';
	import { applyWithUndo, showToast } from '#lib/client/toast.svelte.ts';
	import { addField, deleteRecords, reorder, shifted, updateRecord } from '#lib/core/actions.ts';
	import { toDisplay } from '#lib/core/formula.ts';
	import type { Change, Choice, FieldDef, FieldType, FormatKey, Value } from '#lib/core/model.ts';
	import { formatSet, hasChoices } from '#lib/core/model.ts';
	import { retypeField } from '#lib/core/retype.ts';
	import { CURRENCIES, ratingScale } from '#lib/core/values.ts';
	import Button from '#lib/ui/Button.svelte';
	import { DATA_COLORS, swatch } from '#lib/ui/colors.ts';
	import Field from '#lib/ui/Field.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import Select from '#lib/ui/Select.svelte';
	import { checkbox, input, textarea } from '#lib/ui/styles.ts';

	import { typeLabel, typeOptions } from './field-types.ts';

	let {
		open = $bindable(false),
		tableId,
		fieldId = null,
		preset = null
	}: {
		open?: boolean;
		tableId: string;
		fieldId?: string | null;
		preset?: { name: string; type: FieldType; at?: number } | null;
	} = $props();

	const TYPES = typeOptions();
	const AUTO = 'auto';
	const DECIMALS = [
		{ value: AUTO, label: 'Auto' },
		...['0', '1', '2', '3', '4'].map((value) => ({ value, label: value }))
	];
	const names = new Intl.DisplayNames(undefined, { type: 'currency' });
	const MONEY = CURRENCIES.map((code) => ({ value: code, label: `${names.of(code)} (${code})` }));
	const LOWEST = ['0', '1'].map((value) => ({ value, label: value }));
	const HIGHEST = ['3', '4', '5', '6', '7', '8', '9', '10'].map((value) => ({
		value,
		label: value
	}));
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
			newChoice,
			format: format()
		});

	/** The format the sheet's controls describe, for the type picked. */
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
			seconds: clock === 'seconds' ? true : undefined
		};
		return formatSet(type, options) as Partial<Pick<FieldDef, FormatKey>>;
	}
	const dirty = $derived(open && snapshot() !== start);

	const existing = $derived.by(() => {
		void app.version;
		return fieldId === null ? undefined : app.ws.field(fieldId);
	});

	const tables = $derived.by(() => {
		void app.version;
		const table = app.ws.table(tableId);
		return table === undefined ? [] : app.ws.tables(table.base);
	});

	const siblings = $derived.by(() => {
		void app.version;
		return app.ws.fields(tableId).map((field) => field.id);
	});

	/** A rating's new scale can leave values off it, as a new type can. */
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
					{ type, target: target || null, expr, choices: $state.snapshot(choices), ...format() },
					existing.type === 'formula' ? app.computed(tableId) : undefined
				);
	}

	const retypeHint = $derived.by(() => {
		void app.version;
		const result = open ? conversion() : null;
		if (result === null) return undefined;
		if (type === 'formula') return 'The values here give way to the formula.';
		if (type === 'link' && target === '') return 'Pick the table to link to.';
		if (result.lost === 0) return existing?.type === type ? undefined : 'Every value carries over.';
		return `${result.lost} ${result.lost === 1 ? 'value' : 'values'} can't become ${typeLabel(type)} and will be cleared.`;
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
			currency = field?.currency ?? localCurrency();
			const scale = ratingScale(field ?? {});
			lowest = String(scale.min);
			highest = String(scale.max);
			half = field?.type === 'rating' && scale.step === 0.5;
			clock = field?.seconds ? 'seconds' : 'minutes';
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

	function save(): void {
		problem = '';
		if (name.trim() === '') {
			problem = 'Give this field a name.';
			return;
		}
		if (type === 'link' && target === '') {
			problem = 'Pick the table to link to.';
			return;
		}

		let expr: string | null = null;
		if (type === 'formula') {
			const read = readFormula(tableId, fieldId, formula);
			if ('problem' in read) {
				problem = read.problem;
				return;
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

		if (existing === undefined) {
			const [made, ...moves] = addField(
				app.ws,
				tableId,
				{ name: name.trim(), type },
				preset?.at
			).changes;
			applyWithUndo(
				[{ ...made, set: { ...made.set, ...set } }, ...moves],
				`Field "${name.trim()}" added`
			);
		} else {
			applyWithUndo(
				[...(retyped?.changes ?? []), ...updateRecord(app.ws, existing.id, set)],
				`Field "${name.trim()}" changed`
			);
		}
		open = false;
	}

	function remove(): void {
		if (existing === undefined) {
			return;
		}
		const label = `Field "${existing.name}" deleted`;
		const group = app.apply(deleteRecords(app.ws, [existing.id]), label);
		showToast(label, group?.id ?? null);
		open = false;
	}

	function move(by: number): void {
		if (existing !== undefined) {
			applyWithUndo(
				reorder(app.ws, shifted(siblings, existing.id, by)),
				`Field "${existing.name}" moved`
			);
		}
	}
</script>

<Dialog bind:open title={existing === undefined ? 'New field' : 'Field'} {dirty} onsubmit={save}>
	<div class="flex flex-col gap-3">
		<Field label="Name">
			<input class={input} bind:value={name} placeholder="Weight, Exercise, Amount" />
		</Field>

		<Field label="Type" hint={retypeHint}>
			<Select options={TYPES} value={type} onchange={pickType} />
		</Field>

		{#if hasChoices(type)}
			<div class="flex flex-col gap-2">
				<span class="text-sm font-medium text-ink-2">Choices</span>
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
								aria-label="Remove {choice.name}"
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
						placeholder="Add a choice"
						aria-label="Add a choice"
						onkeydown={(event) => {
							if (event.key === 'Enter' && newChoice.trim() !== '') {
								event.preventDefault();
								addChoice();
							}
						}}
					/>
					<Button aria-label="Add this choice" onclick={addChoice}><Icon name="plus" /></Button>
				</div>
			</div>
		{/if}

		{#if type === 'link'}
			<Field label="Linked table">
				<Select
					options={tables.map((table) => ({ value: table.id, label: table.name }))}
					bind:value={target}
					placeholder="Pick a table"
					disabled={existing?.type === 'link'}
				/>
			</Field>
		{/if}

		{#if type === 'formula'}
			<Field label="Formula">
				<textarea
					class="{textarea} h-24"
					bind:value={formula}
					spellcheck="false"
					placeholder={'"Weight" * (1 + "Reps" / 30.0)'}></textarea>
			</Field>
		{/if}

		{#if type === 'number'}
			<div class="grid grid-cols-3 gap-2">
				<Field label="Decimals">
					<Select options={DECIMALS} bind:value={decimals} />
				</Field>
				<Field label="Unit">
					<input class={input} bind:value={unit} placeholder="kg" />
				</Field>
				<Field label="Step">
					<input class={input} inputmode="decimal" bind:value={step} placeholder="1" />
				</Field>
			</div>
			<label class="flex items-center gap-2">
				<input type="checkbox" class={checkbox} bind:checked={grouping} />
				Group thousands
			</label>
		{:else if type === 'currency'}
			<div class="grid grid-cols-3 gap-2">
				<div class="col-span-2">
					<Field label="Currency">
						<Select options={MONEY} bind:value={currency} />
					</Field>
				</div>
				<Field label="Decimals">
					<Select options={DECIMALS} bind:value={decimals} />
				</Field>
			</div>
		{:else if type === 'percent'}
			<div class="grid grid-cols-3 gap-2">
				<Field label="Decimals">
					<Select options={DECIMALS} bind:value={decimals} />
				</Field>
			</div>
		{:else if type === 'rating'}
			<div class="grid grid-cols-3 gap-2">
				<Field label="Lowest">
					<Select options={LOWEST} bind:value={lowest} />
				</Field>
				<Field label="Highest">
					<Select options={HIGHEST} bind:value={highest} />
				</Field>
			</div>
			<label class="flex items-center gap-2">
				<input type="checkbox" class={checkbox} bind:checked={half} />
				Half points
			</label>
		{:else if type === 'duration'}
			<div class="grid grid-cols-3 gap-2">
				<Field label="Format">
					<Select options={CLOCKS} bind:value={clock} />
				</Field>
			</div>
		{/if}

		<Field label="Description">
			<input
				class={input}
				bind:value={description}
				placeholder="What this field holds, in one sentence"
			/>
		</Field>

		{#if problem}
			<p class="rounded-box bg-tint p-2" role="alert">{problem}</p>
		{/if}
	</div>

	{#snippet footer()}
		{#if existing !== undefined}
			<Button variant="ghost" onclick={remove}>Delete</Button>
			<Button
				variant="ghost"
				class="w-control px-0"
				aria-label="Move left"
				disabled={siblings[0] === existing.id}
				onclick={() => move(-1)}><Icon name="arrow-left" /></Button
			>
			<Button
				variant="ghost"
				class="w-control px-0"
				aria-label="Move right"
				disabled={siblings.at(-1) === existing.id}
				onclick={() => move(1)}><Icon name="arrow-right" /></Button
			>
		{/if}
		<div class="flex-1"></div>
		<Button variant="primary" onclick={save}>Save</Button>
	{/snippet}
</Dialog>
