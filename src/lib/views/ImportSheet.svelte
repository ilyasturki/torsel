<script lang="ts">
	import { tick } from 'svelte';

	import { goto } from '$app/navigation';

	import { app } from '#lib/client/app.svelte.ts';
	import { tableUrl } from '#lib/client/nav.ts';
	import type { ImportStart } from '#lib/client/shell.svelte.ts';
	import { shell } from '#lib/client/shell.svelte.ts';
	import { showToast } from '#lib/client/toast.svelte.ts';
	import { homeBase, nextTableName } from '#lib/core/actions.ts';
	import { parseExport, restoreChanges } from '#lib/core/backup.ts';
	import type { ColumnGuess } from '#lib/core/csv.ts';
	import {
		NEW_FIELD,
		SKIP,
		appendRows,
		guessColumns,
		guessTargets,
		importTable,
		parseCsv,
		withHeader
	} from '#lib/core/csv.ts';
	import type { FieldType, Rec } from '#lib/core/model.ts';
	import Button from '#lib/ui/Button.svelte';
	import Field from '#lib/ui/Field.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';
	import { input, select, textarea } from '#lib/ui/styles.ts';

	const TYPES: { id: FieldType; label: string }[] = [
		{ id: 'text', label: 'Text' },
		{ id: 'number', label: 'Number' },
		{ id: 'date', label: 'Date' },
		{ id: 'choice', label: 'Choice' },
		{ id: 'check', label: 'Checkbox' }
	];

	const NEW_TABLE = '';

	const plural = (count: number, noun: string): string =>
		`${count} ${noun}${count === 1 ? '' : 's'}`;

	let open = $state(false);
	let rows = $state.raw<string[][]>([]);
	let columns = $state<ColumnGuess[]>([]);
	let targets = $state<string[]>([]);
	let records = $state.raw<Rec[] | null>(null);
	let into = $state(NEW_TABLE);
	let tableName = $state('');
	let base = $state('');
	let problem = $state('');
	let body: HTMLElement | undefined = $state();

	const hasColumns = $derived(columns.length > 0);
	const ready = $derived(hasColumns || records !== null);

	const tables = $derived.by(() => {
		void app.version;
		return app.ws.bases().flatMap((item) => app.ws.tables(item.id));
	});

	const bases = $derived.by(() => {
		void app.version;
		return app.ws.bases();
	});

	const fields = $derived.by(() => {
		void app.version;
		return into === NEW_TABLE
			? []
			: app.ws.fields(into).filter((field) => field.type !== 'formula');
	});

	const summary = $derived.by(() => {
		if (records === null) return '';
		const count = (kind: Rec['kind']): number =>
			(records ?? []).filter((rec) => rec.kind === kind && rec.data._del !== true).length;
		const tableCount = count('table');
		const rowCount = count('row');
		return `${tableCount} ${tableCount === 1 ? 'table' : 'tables'}, ${rowCount} ${rowCount === 1 ? 'row' : 'rows'}.`;
	});

	$effect(() => {
		const start = shell.importing;
		if (start !== null) {
			shell.importing = null;
			rows = [];
			columns = [];
			targets = [];
			records = null;
			problem = '';
			base = bases.length > 1 ? homeBase(app.ws).id : '';
			into = start.into ?? NEW_TABLE;
			tableName = '';
			open = true;
			if (start.file !== undefined || start.text !== undefined) void read(start);
		}
	});

	async function read(start: ImportStart): Promise<void> {
		problem = '';
		const text = start.text ?? (await start.file?.text()) ?? '';

		if (text.trimStart().startsWith('{')) {
			records = parseExport(text);
			if (records === null) problem = 'This file isn’t a Torsel export.';
		} else {
			const parsed = withHeader(parseCsv(text, start.text === undefined ? undefined : '\t'));
			if (parsed.length < 2) {
				problem = 'This has no rows to import.';
				return;
			}
			rows = parsed;
			columns = guessColumns(parsed);
			tableName = start.file?.name.replace(/\.(csv|tsv|txt)$/iu, '') ?? nextTableName(app.ws);
			pickTable(into);
		}

		// The control that had focus is gone: Enter should still import.
		await tick();
		const sheet = body?.closest<HTMLElement>('[role="dialog"]');
		(body?.querySelector<HTMLElement>('select, input') ?? sheet)?.focus();
	}

	function pickTable(id: string): void {
		into = id;
		targets = id === NEW_TABLE ? [] : guessTargets(columns, app.ws.fields(id));
	}

	function sample(index: number): string {
		return rows.slice(1).find((cells) => (cells[index] ?? '').trim() !== '')?.[index] ?? '';
	}

	function restore(): void {
		const changes = restoreChanges(app.ws, records ?? []);
		const label = changes.length === 0 ? 'Nothing to restore' : 'Export restored';
		const group = app.apply(changes, label);
		showToast(label, group?.id ?? null);
		open = false;
	}

	function append(): void {
		const { changes, count, unread } = appendRows(
			app.ws,
			into,
			rows,
			$state.snapshot(columns),
			targets
		);
		const name = app.ws.table(into)?.name ?? '';
		const label = `${count} ${count === 1 ? 'row' : 'rows'} imported into "${name}"`;
		const group = app.apply(changes, label);
		showToast(
			unread === 0 ? label : `${label}, ${unread} ${unread === 1 ? 'value' : 'values'} left empty`,
			group?.id ?? null
		);
		open = false;
		void goto(tableUrl(into));
	}

	function create(): void {
		const name = tableName.trim() || nextTableName(app.ws);
		const home = base === '' ? homeBase(app.ws) : { id: base, changes: [] };
		const made = importTable(app.ws, home.id, name, rows, $state.snapshot(columns));
		const count = rows.length - 1;
		const label = `${count} ${count === 1 ? 'row' : 'rows'} imported into "${name}"`;
		const group = app.apply([...home.changes, ...made.changes], label);
		showToast(label, group?.id ?? null);
		open = false;
		void goto(tableUrl(made.id));
	}

	function run(): void {
		if (records !== null) restore();
		else if (!hasColumns) return;
		else if (into === NEW_TABLE) create();
		else append();
	}
</script>

<Sheet
	bind:open
	title="Import"
	description={ready
		? undefined
		: 'A CSV from Google Sheets or Excel, a Torsel export, or cells you paste.'}
	dirty={ready}
	typeOnOpen={false}
	onsubmit={run}
>
	<div class="flex flex-col gap-3" bind:this={body}>
		{#if !ready}
			<input
				type="file"
				accept=".csv,.tsv,.txt,.json,text/csv,application/json"
				aria-label="File to import"
				class="block w-full file:mr-3 file:h-control file:rounded-box file:border-0 file:bg-fill file:px-3 file:font-medium file:text-on-fill"
				onchange={(event) => {
					const file = event.currentTarget.files?.[0];
					if (file) void read({ file, into: into || null });
				}}
			/>
			<textarea
				class="{textarea} h-24"
				aria-label="Cells to import"
				placeholder="Or paste cells here"
				spellcheck="false"
				onpaste={(event) => {
					const text = event.clipboardData?.getData('text/plain') ?? '';
					if (text !== '') {
						event.preventDefault();
						void read({ text, into: into || null });
					}
				}}></textarea>
		{/if}

		{#if records !== null}
			<p>This export holds {summary}</p>
			<p class="text-ink-2">
				Everything in it comes back over what this device holds now, in one step you can undo.
			</p>
		{/if}

		{#if hasColumns}
			<Field label="Into">
				<select
					class={select}
					value={into}
					onchange={(event) => pickTable(event.currentTarget.value)}
				>
					<option value={NEW_TABLE}>A new table</option>
					{#each tables as table (table.id)}
						<option value={table.id}>{table.name}</option>
					{/each}
				</select>
			</Field>

			{#if into === NEW_TABLE}
				{#if bases.length > 1}
					<Field label="Base">
						<select class={select} bind:value={base}>
							{#each bases as item (item.id)}
								<option value={item.id}>{item.name}</option>
							{/each}
						</select>
					</Field>
				{/if}
				<Field label="Table name">
					<input class={input} bind:value={tableName} />
				</Field>
			{/if}

			<div class="flex flex-col gap-2">
				<span class="text-sm font-medium text-ink-2"
					>{plural(columns.length, 'column')}, {plural(rows.length - 1, 'row')}</span
				>
				<div class="flex flex-col gap-1">
					{#each columns as column, index (index)}
						{#if into === NEW_TABLE}
							<div class="grid grid-cols-3 items-center gap-2">
								<input
									class="{input} col-span-2"
									bind:value={column.name}
									aria-label="Name of column {index + 1}"
								/>
								<select class={select} bind:value={column.type} aria-label="Type of {column.name}">
									{#each TYPES as option (option.id)}
										<option value={option.id}>{option.label}</option>
									{/each}
								</select>
							</div>
						{:else}
							<div class="grid grid-cols-2 items-center gap-2">
								<span class="flex min-w-0 flex-col">
									<span class="truncate font-medium">{column.name}</span>
									<span class="truncate text-sm text-ink-3">{sample(index)}</span>
								</span>
								<select
									class={select}
									bind:value={targets[index]}
									aria-label="Field for {column.name}"
								>
									<option value={NEW_FIELD}>New field</option>
									<option value={SKIP}>Skip</option>
									{#each fields as field (field.id)}
										<option value={field.id}>{field.name}</option>
									{/each}
								</select>
							</div>
						{/if}
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
		<Button variant="primary" disabled={!ready} onclick={run}
			>{records === null ? 'Import' : 'Restore'}</Button
		>
	{/snippet}
</Sheet>
