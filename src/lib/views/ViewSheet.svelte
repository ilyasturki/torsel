<script lang="ts">
	import { goto } from '$app/navigation';

	import { app } from '#lib/client/app.svelte.ts';
	import { showToast } from '#lib/client/toast.svelte.ts';
	import { createView, defaultMatch, deleteRecords, updateRecord } from '#lib/core/actions.ts';
	import type { ChartConfig, FieldDef, Value, ViewConfig, ViewType } from '#lib/core/model.ts';
	import Button from '#lib/ui/Button.svelte';
	import Field from '#lib/ui/Field.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';
	import { input, select } from '#lib/ui/styles.ts';

	let {
		open = $bindable(false),
		tableId,
		viewId = null
	}: { open?: boolean; tableId: string; viewId?: string | null } = $props();

	const TYPES: { id: ViewType; label: string; hint: string }[] = [
		{ id: 'grid', label: 'Grille', hint: 'Le tableur, toutes les lignes' },
		{ id: 'entry', label: 'Saisie', hint: 'Ajouter vite, pré-rempli depuis la dernière fois' },
		{ id: 'list', label: 'Liste', hint: 'Des cartes regroupées' },
		{ id: 'chart', label: 'Graphique', hint: 'Barres ou courbe d’un agrégat' }
	];

	let name = $state('');
	let type = $state<ViewType>('grid');
	let config = $state<ViewConfig>({});

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
		const label = name.trim() || (TYPES.find((option) => option.id === type)?.label ?? 'Vue');
		const clean = JSON.parse(JSON.stringify(config)) as Value;

		if (existing === undefined) {
			const { id, changes } = createView(app.ws, tableId, {
				name: label,
				type,
				config: clean as ViewConfig
			});
			app.apply(changes, `Vue « ${label} » ajoutée`);
			const table = app.ws.table(tableId);
			if (table) void goto(`/app/b/${table.base}/${tableId}?v=${id}`);
		} else {
			app.apply(
				updateRecord(app.ws, existing.id, { name: label, config: clean }),
				`Vue « ${label} » modifiée`
			);
		}
		open = false;
	}

	function remove(): void {
		if (existing === undefined) return;
		const group = app.apply(
			deleteRecords(app.ws, [existing.id]),
			`Vue « ${existing.name} » supprimée`
		);
		showToast(`Vue « ${existing.name} » supprimée`, group?.id ?? null);
		open = false;
		const table = app.ws.table(tableId);
		if (table) void goto(`/app/b/${table.base}/${tableId}`);
	}

	const checked = (
		key: 'hidden' | 'fields' | 'match' | 'show',
		field: FieldDef,
		fallback: string[]
	): boolean => (config[key] ?? fallback).includes(field.id);
</script>

<Sheet bind:open title={existing === undefined ? 'Nouvelle vue' : 'Réglages de la vue'}>
	<div class="flex flex-col gap-4">
		{#if existing === undefined}
			<div class="grid grid-cols-2 gap-2">
				{#each TYPES as option (option.id)}
					<button
						type="button"
						class="flex flex-col gap-0.5 rounded-2xl border p-3 text-left {type === option.id
							? 'border-ink'
							: 'border-line'}"
						aria-pressed={type === option.id}
						onclick={() => (type = option.id)}
					>
						<span class="text-[15px] font-semibold">{option.label}</span>
						<span class="text-xs text-ink-muted">{option.hint}</span>
					</button>
				{/each}
			</div>
		{/if}

		<Field label="Nom">
			<input
				class={input}
				bind:value={name}
				placeholder={TYPES.find((option) => option.id === type)?.label}
			/>
		</Field>

		{#if type === 'grid'}
			<fieldset class="flex flex-col gap-1">
				<legend class="mb-1 text-[13px] font-medium text-ink-muted">Champs affichés</legend>
				{#each fields as field (field.id)}
					<label class="flex min-h-10 items-center gap-3">
						<input
							type="checkbox"
							class="size-5 accent-current"
							checked={!checked('hidden', field, [])}
							onchange={() => toggle('hidden', field.id, [])}
						/>
						{field.name}
					</label>
				{/each}
			</fieldset>
		{:else if type === 'entry'}
			<fieldset class="flex flex-col gap-1">
				<legend class="mb-1 text-[13px] font-medium text-ink-muted">Champs à saisir</legend>
				{#each entryFields as field (field.id)}
					<label class="flex min-h-10 items-center gap-3">
						<input
							type="checkbox"
							class="size-5"
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
				<legend class="mb-1 text-[13px] font-medium text-ink-muted"
					>« La dernière fois » se lit sur…</legend
				>
				<p class="mb-1 text-xs text-ink-faint">
					La saisie se pré-remplit depuis la dernière ligne qui a les mêmes valeurs pour ces champs,
					par exemple le même exercice.
				</p>
				{#each keyCandidates as field (field.id)}
					<label class="flex min-h-10 items-center gap-3">
						<input
							type="checkbox"
							class="size-5"
							checked={checked('match', field, fallbackMatch)}
							onchange={() => toggle('match', field.id, fallbackMatch)}
						/>
						{field.name}
					</label>
				{/each}
			</fieldset>
		{:else if type === 'list'}
			<Field label="Regrouper par">
				<select
					class={select}
					value={config.group ?? ''}
					onchange={(event) => (config.group = event.currentTarget.value || null)}
				>
					<option value="">Rien</option>
					{#each fields as field (field.id)}
						<option value={field.id}>{field.name}</option>
					{/each}
				</select>
			</Field>
			<Field label="Titre des cartes">
				<select
					class={select}
					value={config.title ?? ''}
					onchange={(event) => (config.title = event.currentTarget.value || null)}
				>
					<option value="">Automatique</option>
					{#each fields as field (field.id)}
						<option value={field.id}>{field.name}</option>
					{/each}
				</select>
			</Field>
			<fieldset class="flex flex-col gap-1">
				<legend class="mb-1 text-[13px] font-medium text-ink-muted">Champs sous le titre</legend>
				{#each fields as field (field.id)}
					<label class="flex min-h-10 items-center gap-3">
						<input
							type="checkbox"
							class="size-5"
							checked={checked('show', field, [])}
							onchange={() => toggle('show', field.id, [])}
						/>
						{field.name}
					</label>
				{/each}
			</fieldset>
		{:else}
			<div class="grid grid-cols-2 gap-2">
				{#each [{ id: 'bar', label: 'Barres' }, { id: 'line', label: 'Courbe' }] as option (option.id)}
					<button
						type="button"
						class="h-11 rounded-xl border text-[15px] font-medium {(config.kind ?? 'bar') ===
						option.id
							? 'border-ink'
							: 'border-line'}"
						onclick={() => setChart('kind', option.id as 'bar' | 'line')}>{option.label}</button
					>
				{/each}
			</div>
			<Field label="Axe horizontal">
				<select
					class={select}
					value={config.x ?? ''}
					onchange={(event) => setChart('x', event.currentTarget.value || null)}
				>
					<option value="">—</option>
					{#each fields as field (field.id)}
						<option value={field.id}>{field.name}</option>
					{/each}
				</select>
			</Field>
			{#if xField?.type === 'date'}
				<Field label="Regrouper les dates par">
					<select
						class={select}
						value={config.bucket ?? 'day'}
						onchange={(event) =>
							setChart('bucket', event.currentTarget.value as ChartConfig['bucket'])}
					>
						<option value="day">Jour</option>
						<option value="week">Semaine</option>
						<option value="month">Mois</option>
					</select>
				</Field>
			{/if}
			<div class="grid grid-cols-2 gap-3">
				<Field label="Calcul">
					<select
						class={select}
						value={config.agg ?? 'count'}
						onchange={(event) => setChart('agg', event.currentTarget.value as ChartConfig['agg'])}
					>
						<option value="count">Nombre de lignes</option>
						<option value="sum">Somme</option>
						<option value="avg">Moyenne</option>
						<option value="max">Maximum</option>
						<option value="min">Minimum</option>
					</select>
				</Field>
				<Field label="De">
					<select
						class={select}
						value={config.y ?? ''}
						disabled={(config.agg ?? 'count') === 'count'}
						onchange={(event) => setChart('y', event.currentTarget.value || null)}
					>
						<option value="">—</option>
						{#each numeric as field (field.id)}
							<option value={field.id}>{field.name}</option>
						{/each}
					</select>
				</Field>
			</div>
			<Field label="Couleur par">
				<select
					class={select}
					value={config.color ?? ''}
					onchange={(event) => setChart('color', event.currentTarget.value || null)}
				>
					<option value="">Une seule série</option>
					{#each choices as field (field.id)}
						<option value={field.id}>{field.name}</option>
					{/each}
				</select>
			</Field>
			{#if (config.kind ?? 'bar') === 'line' && xField?.type === 'date'}
				<Field
					label="Moyenne glissante (jours)"
					hint="Vide pour la courbe brute. 7 lisse une pesée quotidienne."
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
			<Button variant="ghost" onclick={remove}>Supprimer</Button>
		{/if}
		<div class="flex-1"></div>
		<Button variant="primary" onclick={save}
			>{existing === undefined ? 'Créer' : 'Enregistrer'}</Button
		>
	{/snippet}
</Sheet>
