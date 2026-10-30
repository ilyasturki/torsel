<script lang="ts">
	import { goto } from '$app/navigation';

	import { app } from '#lib/client/app.svelte.ts';
	import { tableUrl } from '#lib/client/nav.ts';
	import { showToast } from '#lib/client/toast.svelte.ts';
	import { homeBase } from '#lib/core/actions.ts';
	import type { ColumnGuess } from '#lib/core/csv.ts';
	import { guessColumns, importTable, parseCsv } from '#lib/core/csv.ts';
	import type { FieldType } from '#lib/core/model.ts';
	import Button from '#lib/ui/Button.svelte';
	import Field from '#lib/ui/Field.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';
	import { input, select } from '#lib/ui/styles.ts';

	let { open = $bindable(false) }: { open?: boolean } = $props();

	const TYPES: { id: FieldType; label: string }[] = [
		{ id: 'text', label: 'Text' },
		{ id: 'number', label: 'Number' },
		{ id: 'date', label: 'Date' },
		{ id: 'choice', label: 'Choice' },
		{ id: 'check', label: 'Checkbox' }
	];

	let rows = $state.raw<string[][]>([]);
	let columns = $state<ColumnGuess[]>([]);
	let tableName = $state('');
	let target = $state('');
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
			target = '';
		}
	});

	async function read(file: File): Promise<void> {
		problem = '';
		const parsed = parseCsv(await file.text());
		if (parsed.length < 2) {
			problem = 'This file has no rows to import.';
			return;
		}
		rows = parsed;
		columns = guessColumns(parsed);
		tableName = file.name.replace(/\.(csv|tsv|txt)$/iu, '');
	}

	function run(): void {
		const label = tableName.trim() || 'Import';
		const home = target === '' ? homeBase(app.ws) : { id: target, changes: [] };

		const fixed = columns.map((column, index) => ({
			...column,
			choices:
				column.type === 'choice'
					? [...new Set(rows.slice(1).map((cells) => (cells[index] ?? '').trim()))]
							.filter((value) => value !== '')
							.sort((a, b) => a.localeCompare(b))
					: []
		}));
		const { id, changes } = importTable(app.ws, home.id, label, rows, fixed);
		const count = rows.length - 1;
		const summary = `${count} ${count === 1 ? 'row' : 'rows'} imported into "${label}"`;
		const group = app.apply([...home.changes, ...changes], summary);
		showToast(summary, group?.id ?? null);
		open = false;
		void goto(tableUrl(id));
	}
</script>

<Sheet
	bind:open
	title="Import a CSV"
	description="An export from Google Sheets or Excel. Column types are guessed, and you can change them."
	dirty={columns.length > 0}
>
	<div class="flex flex-col gap-3">
		<input
			type="file"
			accept=".csv,.tsv,.txt,text/csv"
			class="block w-full file:mr-3 file:h-control file:rounded-box file:border-0 file:bg-fill file:px-3 file:font-medium file:text-on-fill"
			onchange={(event) => {
				const file = event.currentTarget.files?.[0];
				if (file) void read(file);
			}}
		/>

		{#if columns.length > 0}
			<div class="flex flex-col gap-3">
				{#if bases.length > 1}
					<Field label="Base">
						<select class={select} bind:value={target}>
							{#each bases as base (base.id)}
								<option value={base.id}>{base.name}</option>
							{/each}
						</select>
					</Field>
				{/if}
				<Field label="Table name">
					<input class={input} bind:value={tableName} />
				</Field>
			</div>

			<div class="flex flex-col gap-2">
				<span class="text-sm font-medium text-ink-2"
					>{columns.length} columns, {rows.length - 1} rows</span
				>
				<div class="flex flex-col gap-1">
					{#each columns as column, index (index)}
						<div class="flex items-center gap-2">
							<input
								class="{input} flex-1"
								bind:value={column.name}
								aria-label="Name of column {index + 1}"
							/>
							<select
								class="{select} w-28 shrink-0"
								bind:value={column.type}
								aria-label="Type of {column.name}"
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
			<p class="rounded-box bg-tint p-2" role="alert">{problem}</p>
		{/if}
	</div>

	{#snippet footer()}
		<div class="flex-1"></div>
		<Button variant="primary" disabled={columns.length === 0} onclick={run}>Import</Button>
	{/snippet}
</Sheet>
