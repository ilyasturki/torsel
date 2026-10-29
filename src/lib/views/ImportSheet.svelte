<script lang="ts">
	import { goto } from '$app/navigation';

	import { app } from '#lib/client/app.svelte.ts';
	import { showToast } from '#lib/client/toast.svelte.ts';
	import { createBase } from '#lib/core/actions.ts';
	import type { ColumnGuess } from '#lib/core/csv.ts';
	import { guessColumns, importTable, parseCsv } from '#lib/core/csv.ts';
	import type { FieldType } from '#lib/core/model.ts';
	import Button from '#lib/ui/Button.svelte';
	import Field from '#lib/ui/Field.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';
	import { input, select } from '#lib/ui/styles.ts';

	let { open = $bindable(false), baseId = null }: { open?: boolean; baseId?: string | null } =
		$props();

	const TYPES: { id: FieldType; label: string }[] = [
		{ id: 'text', label: 'Texte' },
		{ id: 'number', label: 'Nombre' },
		{ id: 'date', label: 'Date' },
		{ id: 'choice', label: 'Choix' },
		{ id: 'check', label: 'Case' }
	];

	let rows = $state.raw<string[][]>([]);
	let columns = $state<ColumnGuess[]>([]);
	let tableName = $state('');
	let target = $state('');
	let baseName = $state('');
	let problem = $state('');

	const bases = $derived.by(() => {
		void app.version;
		return app.ws.bases();
	});

	$effect(() => {
		if (open) {
			rows = [];
			columns = [];
			tableName = '';
			problem = '';
			target = baseId ?? '';
			baseName = '';
		}
	});

	async function read(file: File): Promise<void> {
		problem = '';
		const parsed = parseCsv(await file.text());
		if (parsed.length < 2) {
			problem = 'Ce fichier ne contient pas de lignes à importer.';
			return;
		}
		rows = parsed;
		columns = guessColumns(parsed);
		tableName = file.name.replace(/\.(csv|tsv|txt)$/iu, '');
		if (target === '' && baseName === '') baseName = tableName;
	}

	function run(): void {
		let base = target;
		const label = tableName.trim() || 'Import';

		if (base === '') {
			const made = createBase(app.ws, baseName.trim() || label);
			app.apply(made.changes, `Base « ${baseName.trim() || label} » créée`);
			base = made.id;
		}

		const fixed = columns.map((column, index) => ({
			...column,
			choices:
				column.type === 'choice'
					? [...new Set(rows.slice(1).map((cells) => (cells[index] ?? '').trim()))]
							.filter((value) => value !== '')
							.sort((a, b) => a.localeCompare(b))
					: []
		}));
		const { id, changes } = importTable(app.ws, base, label, rows, fixed);
		const group = app.apply(changes, `Import de ${rows.length - 1} lignes`);
		showToast(`${rows.length - 1} lignes importées dans « ${label} »`, group?.id ?? null);
		open = false;
		void goto(`/b/${base}/${id}`);
	}
</script>

<Sheet
	bind:open
	title="Importer un CSV"
	description="Un export Google Sheets, Excel ou kilorep : les types sont devinés, tu peux les corriger."
	wide
>
	<div class="flex flex-col gap-4">
		<input
			type="file"
			accept=".csv,.tsv,.txt,text/csv"
			class="block w-full text-sm file:mr-3 file:h-11 file:rounded-xl file:border-0 file:bg-fill file:px-4 file:font-semibold file:text-on-fill"
			onchange={(event) => {
				const file = event.currentTarget.files?.[0];
				if (file) void read(file);
			}}
		/>

		{#if columns.length > 0}
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<Field label="Base">
					<select class={select} bind:value={target}>
						<option value="">Nouvelle base…</option>
						{#each bases as base (base.id)}
							<option value={base.id}>{base.name}</option>
						{/each}
					</select>
				</Field>
				{#if target === ''}
					<Field label="Nom de la nouvelle base">
						<input class={input} bind:value={baseName} />
					</Field>
				{/if}
				<Field label="Nom de la table">
					<input class={input} bind:value={tableName} />
				</Field>
			</div>

			<div class="flex flex-col gap-2">
				<span class="text-[13px] font-medium text-ink-muted"
					>{columns.length} colonnes, {rows.length - 1} lignes</span
				>
				<div class="overflow-hidden rounded-2xl border border-line-soft">
					{#each columns as column, index (index)}
						<div
							class="flex items-center gap-3 border-b border-line-soft px-3 py-2 last:border-b-0"
						>
							<input
								class="h-10 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 text-[15px] outline-none focus:border-ink"
								bind:value={column.name}
								aria-label="Nom de la colonne {index + 1}"
							/>
							<select
								class="h-10 w-32 shrink-0 rounded-xl border border-line bg-surface px-3 text-[15px] outline-none focus:border-ink"
								bind:value={column.type}
								aria-label="Type de {column.name}"
							>
								{#each TYPES as option (option.id)}
									<option value={option.id}>{option.label}</option>
								{/each}
							</select>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		{#if problem}
			<p class="rounded-xl bg-surface-2 px-3 py-2 text-sm" role="alert">{problem}</p>
		{/if}
	</div>

	{#snippet footer()}
		<div class="flex-1"></div>
		<Button variant="primary" disabled={columns.length === 0} onclick={run}>Importer</Button>
	{/snippet}
</Sheet>
