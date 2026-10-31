<script lang="ts">
	import { untrack } from 'svelte';

	import { app } from '#lib/client/app.svelte.ts';
	import { formatNumber } from '#lib/client/format.ts';
	import { showToast } from '#lib/client/toast.svelte.ts';
	import { addField, deleteRecords, reorder, shifted, updateRecord } from '#lib/core/actions.ts';
	import { FormulaError, toDisplay, toStored } from '#lib/core/formula.ts';
	import type { Change, Choice, FieldType, Value } from '#lib/core/model.ts';
	import { retypeField } from '#lib/core/retype.ts';
	import Button from '#lib/ui/Button.svelte';
	import { DATA_COLORS, swatch } from '#lib/ui/colors.ts';
	import Field from '#lib/ui/Field.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';
	import { input, select, textarea } from '#lib/ui/styles.ts';

	let {
		open = $bindable(false),
		tableId,
		fieldId = null,
		preset = null
	}: {
		open?: boolean;
		tableId: string;
		fieldId?: string | null;
		preset?: { name: string; type: FieldType } | null;
	} = $props();

	const TYPES: { id: FieldType; label: string }[] = [
		{ id: 'text', label: 'Text' },
		{ id: 'number', label: 'Number' },
		{ id: 'date', label: 'Date' },
		{ id: 'choice', label: 'Choice' },
		{ id: 'check', label: 'Checkbox' },
		{ id: 'link', label: 'Link to a table' },
		{ id: 'formula', label: 'Formula (SQL)' }
	];

	let name = $state('');
	let type = $state<FieldType>('text');
	let choices = $state<Choice[]>([]);
	let target = $state('');
	let formula = $state('');
	let description = $state('');
	let step = $state('');
	let newChoice = $state('');
	let problem = $state('');
	let start = $state('');

	const snapshot = (): string =>
		JSON.stringify({ name, type, choices, target, formula, description, step, newChoice });
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

	function conversion(expr: string | null = null): { changes: Change[]; lost: number } | null {
		return existing === undefined || type === existing.type
			? null
			: retypeField(
					app.ws,
					existing.id,
					{ type, target: target || null, expr, choices: $state.snapshot(choices) },
					existing.type === 'formula' ? app.computed(tableId) : undefined
				);
	}

	const retypeHint = $derived.by(() => {
		const result = open ? conversion() : null;
		if (result === null) return undefined;
		if (type === 'formula') return 'The values here give way to the formula.';
		if (type === 'link' && target === '') return 'Pick the table to link to.';
		const label = TYPES.find((option) => option.id === type)?.label ?? type;
		return result.lost === 0
			? 'Every value carries over.'
			: `${result.lost} ${result.lost === 1 ? 'value' : 'values'} can't become ${label} and will be cleared.`;
	});

	$effect(() => {
		if (open) {
			const field = fieldId === null ? undefined : app.ws.field(fieldId);
			const wanted = untrack(() => preset);
			name = field?.name ?? wanted?.name ?? '';
			type = field?.type ?? wanted?.type ?? 'text';
			choices = field?.choices.map((choice) => ({ ...choice })) ?? [];
			target = field?.target ?? '';
			formula = field?.expr ? toDisplay(field.expr, app.ws.fields(tableId)) : '';
			description = field?.description ?? '';
			step = field?.step ? formatNumber(field.step) : '';
			newChoice = '';
			problem = '';
			start = untrack(snapshot);
		}
	});

	function pickType(next: FieldType): void {
		type = next;
		if (next === 'choice' && existing !== undefined && existing.type !== 'choice') {
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
			try {
				expr = toStored(
					formula,
					app.ws.fields(tableId).filter((field) => field.id !== fieldId)
				);
			} catch (error) {
				problem = error instanceof FormulaError ? error.message : String(error);
				return;
			}
			const refused = app.checkFormula(tableId, expr);
			if (refused !== null) {
				problem = `SQLite refused the formula: ${refused}`;
				return;
			}
		}

		const stepValue = Number(step.replace(',', '.'));
		const set: Record<string, Value> = {
			name: name.trim(),
			description: description.trim() === '' ? null : description.trim(),
			step: Number.isFinite(stepValue) && stepValue > 0 ? stepValue : null
		};
		const retyped = conversion(expr);
		if (retyped === null) {
			if (type === 'choice')
				set.choices = choices.map((choice) => ({ name: choice.name, color: choice.color }));
			if (type === 'link') set.target = target || null;
			if (type === 'formula') set.expr = expr;
		}

		if (existing === undefined) {
			const { changes } = addField(app.ws, tableId, { name: name.trim(), type });
			app.apply(
				[{ ...changes[0], set: { ...changes[0].set, ...set } }],
				`Field "${name.trim()}" added`
			);
		} else {
			app.apply(
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
			app.apply(
				reorder(app.ws, shifted(siblings, existing.id, by)),
				`Field "${existing.name}" moved`
			);
		}
	}
</script>

<Sheet bind:open title={existing === undefined ? 'New field' : 'Field'} {dirty} onsubmit={save}>
	<div class="flex flex-col gap-3">
		<Field label="Name">
			<input class={input} bind:value={name} placeholder="Weight, Exercise, Amount" />
		</Field>

		<Field label="Type" hint={retypeHint}>
			<select
				class={select}
				value={type}
				onchange={(event) => pickType(event.currentTarget.value as FieldType)}
			>
				{#each TYPES as option (option.id)}
					<option value={option.id}>{option.label}</option>
				{/each}
			</select>
		</Field>

		{#if type === 'choice'}
			<div class="flex flex-col gap-2">
				<span class="text-sm font-medium text-ink-2">Choices. Click one to change its colour.</span>
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
				<select class={select} bind:value={target} disabled={existing?.type === 'link'}>
					<option value=""></option>
					{#each tables as table (table.id)}
						<option value={table.id}>{table.name}</option>
					{/each}
				</select>
			</Field>
		{/if}

		{#if type === 'formula'}
			<Field
				label="SQL formula"
				hint="A SQLite expression on the row's fields, names in double quotes: &quot;Weight&quot; * (1 + &quot;Reps&quot; / 30.0)"
			>
				<textarea class="{textarea} h-24" bind:value={formula} spellcheck="false"></textarea>
			</Field>
		{/if}

		{#if type === 'number'}
			<Field label="Step of the plus and minus buttons" hint="For example 2.5 for 1.25 kg plates.">
				<input class={input} inputmode="decimal" bind:value={step} placeholder="1" />
			</Field>
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
</Sheet>
