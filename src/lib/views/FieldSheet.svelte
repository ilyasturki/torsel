<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import X from '@lucide/svelte/icons/x';

	import { app } from '#lib/client/app.svelte.ts';
	import { showToast } from '#lib/client/toast.svelte.ts';
	import { addField, deleteRecords, updateRecord } from '#lib/core/actions.ts';
	import { FormulaError, toDisplay, toStored } from '#lib/core/formula.ts';
	import type { Choice, FieldType, Value } from '#lib/core/model.ts';
	import Button from '#lib/ui/Button.svelte';
	import { DATA_COLORS, chipStyle } from '#lib/ui/colors.ts';
	import Field from '#lib/ui/Field.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';
	import { input, select } from '#lib/ui/styles.ts';

	let {
		open = $bindable(false),
		tableId,
		fieldId = null,
		onsort
	}: {
		open?: boolean;
		tableId: string;
		fieldId?: string | null;
		onsort?: (dir: 'asc' | 'desc') => void;
	} = $props();

	const TYPES: { id: FieldType; label: string }[] = [
		{ id: 'text', label: 'Texte' },
		{ id: 'number', label: 'Nombre' },
		{ id: 'date', label: 'Date' },
		{ id: 'choice', label: 'Choix' },
		{ id: 'check', label: 'Case à cocher' },
		{ id: 'link', label: 'Lien vers une table' },
		{ id: 'formula', label: 'Calculé (SQL)' }
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

	const existing = $derived(fieldId === null ? undefined : app.ws.field(fieldId));

	const tables = $derived.by(() => {
		void app.version;
		const table = app.ws.table(tableId);
		return table === undefined ? [] : app.ws.tables(table.base);
	});

	$effect(() => {
		if (open) {
			const field = fieldId === null ? undefined : app.ws.field(fieldId);
			name = field?.name ?? '';
			type = field?.type ?? 'text';
			choices = field?.choices.map((choice) => ({ ...choice })) ?? [];
			target = field?.target ?? '';
			formula = field?.expr ? toDisplay(field.expr, app.ws.fields(tableId)) : '';
			description = field?.description ?? '';
			step = field?.step ? String(field.step).replace('.', ',') : '';
			newChoice = '';
			problem = '';
		}
	});

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
			problem = 'Donne un nom au champ.';
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
				problem = `SQLite refuse la formule : ${refused}`;
				return;
			}
		}

		const stepValue = Number(step.replace(',', '.'));
		const set: Record<string, Value> = {
			name: name.trim(),
			description: description.trim() === '' ? null : description.trim(),
			step: Number.isFinite(stepValue) && stepValue > 0 ? stepValue : null
		};
		if (type === 'choice')
			set.choices = choices.map((choice) => ({ name: choice.name, color: choice.color }));
		if (type === 'link') set.target = target || null;
		if (type === 'formula') set.expr = expr;

		if (existing === undefined) {
			const { changes } = addField(app.ws, tableId, { name: name.trim(), type });
			app.apply(
				[{ ...changes[0], set: { ...changes[0].set, ...set } }],
				`Champ « ${name.trim()} » ajouté`
			);
		} else {
			app.apply(updateRecord(app.ws, existing.id, set), `Champ « ${name.trim()} » modifié`);
		}
		open = false;
	}

	function remove(): void {
		if (existing === undefined) {
			return;
		}
		const group = app.apply(
			deleteRecords(app.ws, [existing.id]),
			`Champ « ${existing.name} » supprimé`
		);
		showToast(`Champ « ${existing.name} » supprimé`, group?.id ?? null);
		open = false;
	}
</script>

<Sheet bind:open title={existing === undefined ? 'Nouveau champ' : 'Champ'}>
	<div class="flex flex-col gap-4">
		<Field label="Nom">
			<input class={input} bind:value={name} placeholder="Poids, Exercice, Montant…" />
		</Field>

		<Field
			label="Type"
			hint={existing === undefined ? undefined : 'Le type ne change pas une fois le champ créé.'}
		>
			<select class={select} bind:value={type} disabled={existing !== undefined}>
				{#each TYPES as option (option.id)}
					<option value={option.id}>{option.label}</option>
				{/each}
			</select>
		</Field>

		{#if type === 'choice'}
			<div class="flex flex-col gap-2">
				<span class="text-[13px] font-medium text-ink-muted"
					>Choix · touche une pastille pour changer sa couleur</span
				>
				<div class="flex flex-wrap gap-2">
					{#each choices as choice, index (choice.name)}
						<span
							class="inline-flex items-center gap-1 rounded-full pl-1"
							style={chipStyle(choice.color)}
						>
							<button
								type="button"
								class="rounded-full px-2 py-1 text-sm font-medium"
								onclick={() => cycleColor(index)}
							>
								{choice.name}
							</button>
							<button
								type="button"
								class="flex size-7 items-center justify-center rounded-full"
								aria-label="Retirer {choice.name}"
								onclick={() => choices.splice(index, 1)}
							>
								<X class="size-3.5" />
							</button>
						</span>
					{/each}
				</div>
				<form
					class="flex gap-2"
					onsubmit={(event) => {
						event.preventDefault();
						addChoice();
					}}
				>
					<input class={input} bind:value={newChoice} placeholder="Ajouter un choix" />
					<Button type="submit" aria-label="Ajouter le choix"><Plus class="size-4" /></Button>
				</form>
			</div>
		{/if}

		{#if type === 'link'}
			<Field label="Table liée">
				<select class={select} bind:value={target} disabled={existing !== undefined}>
					<option value="">—</option>
					{#each tables as table (table.id)}
						<option value={table.id}>{table.name}</option>
					{/each}
				</select>
			</Field>
		{/if}

		{#if type === 'formula'}
			<Field
				label="Formule SQL"
				hint="Une expression SQLite sur les champs de la ligne, noms entre guillemets : &quot;Poids&quot; * (1 + &quot;Reps&quot; / 30.0)"
			>
				<textarea
					class="{input} h-24 py-2 font-mono text-sm"
					bind:value={formula}
					spellcheck="false"></textarea>
			</Field>
		{/if}

		{#if type === 'number'}
			<Field label="Pas des boutons + et −" hint="Par exemple 2,5 pour des disques de 1,25 kg.">
				<input class={input} inputmode="decimal" bind:value={step} placeholder="1" />
			</Field>
		{/if}

		<Field label="Description">
			<input
				class={input}
				bind:value={description}
				placeholder="Ce que le champ contient, en une phrase"
			/>
		</Field>

		{#if existing !== undefined && onsort}
			<div class="flex gap-2">
				<Button
					size="sm"
					onclick={() => {
						onsort?.('asc');
						open = false;
					}}>Trier croissant</Button
				>
				<Button
					size="sm"
					onclick={() => {
						onsort?.('desc');
						open = false;
					}}>Trier décroissant</Button
				>
			</div>
		{/if}

		{#if problem}
			<p class="rounded-xl bg-surface-2 px-3 py-2 text-sm" role="alert">{problem}</p>
		{/if}
	</div>

	{#snippet footer()}
		{#if existing !== undefined}
			<Button variant="ghost" onclick={remove}>Supprimer</Button>
		{/if}
		<div class="flex-1"></div>
		<Button variant="primary" onclick={save}>Enregistrer</Button>
	{/snippet}
</Sheet>
