<script lang="ts">
	import { tick } from 'svelte';

	import { goto } from '$app/navigation';

	import { app } from '#lib/client/app.svelte.ts';
	import { LinkImport } from '#lib/client/link.svelte.ts';
	import { tableUrl } from '#lib/client/nav.ts';
	import type { ImportStart } from '#lib/client/shell.svelte.ts';
	import { shell } from '#lib/client/shell.svelte.ts';
	import { applyWithUndo, showToast } from '#lib/client/toast.svelte.ts';
	import { deleteRecords, homeBase, nextTableName } from '#lib/core/actions.ts';
	import { nameTaken, numberedName } from '#lib/core/names.ts';
	import { parseExport, restoreChanges } from '#lib/core/backup.ts';
	import { names } from '#lib/i18n/names.ts';
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
	import { readXlsx } from '#lib/core/xlsx.ts';
	import type { Rec } from '#lib/core/model.ts';
	import { common } from '#lib/i18n/common.ts';
	import { importing as words } from '#lib/i18n/importing.ts';
	import { table as tableWords } from '#lib/i18n/table.ts';
	import Button from '#lib/ui/Button.svelte';
	import Field from '#lib/ui/Field.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import { fieldIcon } from '#lib/ui/field-icons.ts';
	import Select from '#lib/ui/Select.svelte';
	import { input } from '#lib/ui/styles.ts';

	import { typeOptions } from './field-types.ts';
	import LinkKey from './LinkKey.svelte';
	import LinkPreview from './LinkPreview.svelte';

	const TYPES = typeOptions((type) => type !== 'link' && type !== 'formula');

	const NEW_TABLE = '';

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
	let picker: HTMLInputElement | undefined = $state();
	const link = new LinkImport();
	// A link read: the second step, its preview.
	let linked = $state(false);

	const hasColumns = $derived(columns.length > 0);
	const ready = $derived(hasColumns || records !== null);
	const typed = $derived(link.link.trim() !== '');

	// Only tables that take new rows: a source fills the others.
	const tables = $derived.by(() => {
		void app.version;
		return app.ws
			.bases()
			.flatMap((item) => app.ws.tables(item.id))
			.filter((table) => app.canAddRows(table.id));
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
		return words.holds(count('table'), count('row'));
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
			base = bases.length > 1 ? homeBase(app.ws, names).id : '';
			into = start.into ?? NEW_TABLE;
			tableName = '';
			link.reset();
			linked = false;
			open = true;
			if (start.file !== undefined || start.text !== undefined) void read(start);
		}
	});

	async function read(start: ImportStart): Promise<void> {
		problem = '';
		const file = start.file;
		const workbook =
			file !== undefined && (/\.xlsx$/iu.test(file.name) || file.type.includes('spreadsheetml'));
		const text = workbook ? '' : (start.text ?? (await file?.text()) ?? '');

		if (text.trimStart().startsWith('{')) {
			records = parseExport(text);
			if (records === null) problem = words.notExport;
		} else {
			const cells = workbook
				? ((await readXlsx(new Uint8Array(await file.arrayBuffer()))) ?? [])
				: parseCsv(text, start.text === undefined ? undefined : '\t');
			const parsed = withHeader(cells, names);
			if (parsed.length < 2) {
				problem = words.noRows;
				return;
			}
			rows = parsed;
			columns = guessColumns(parsed, names);
			const fileName = file?.name.replace(/\.(csv|tsv|txt|xlsx)$/iu, '');
			tableName =
				fileName === undefined
					? nextTableName(app.ws, names)
					: numberedName(
							app.ws.bases().flatMap((item) => app.ws.tables(item.id).map((table) => table.name)),
							fileName
						);
			pickTable(into);
		}

		// The control that had focus is gone: Enter should still import.
		await tick();
		const sheet = body?.closest<HTMLElement>('[role="dialog"]');
		(body?.querySelector<HTMLElement>('input') ?? sheet)?.focus();
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
		const label = changes.length === 0 ? words.nothingRestored : words.restored;
		const group = app.apply(changes, label);
		showToast(label, group?.id ?? null);
		open = false;
	}

	function append(): void {
		const { changes, count, unread } = appendRows(
			app.ws,
			names,
			into,
			rows,
			$state.snapshot(columns),
			targets
		);
		const name = app.ws.table(into)?.name ?? '';
		const label = words.imported(count, name);
		const group = app.apply(changes, label);
		showToast(unread === 0 ? label : words.leftEmpty(label, unread), group?.id ?? null);
		open = false;
		void goto(tableUrl(into));
	}

	function create(): void {
		const name = tableName.trim() || nextTableName(app.ws, names);
		const home = base === '' ? homeBase(app.ws, names) : { id: base, changes: [] };
		const holder = nameTaken(app.ws.tables(home.id), name);
		if (holder !== undefined) {
			problem = tableWords.nameTaken(holder.name);
			return;
		}
		const made = importTable(app.ws, names, home.id, name, rows, $state.snapshot(columns));
		const label = words.imported(rows.length - 1, name);
		const group = app.apply([...home.changes, ...made.changes], label);
		showToast(label, group?.id ?? null);
		open = false;
		void goto(tableUrl(made.id));
	}

	/** What was typed: a link reads into a preview, anything else as pasted cells. */
	async function proceed(): Promise<void> {
		const text = link.link.trim();
		if (!/^\S+\.\S+$/u.test(text)) {
			await read({ text: link.link, into: into || null });
			return;
		}
		if (!/^https?:\/\//iu.test(text)) link.link = `https://${text}`;
		linked = await link.read();
	}

	async function createLinked(): Promise<void> {
		const made = await link.create(base === '' ? null : base);
		if (made === null) return;
		const name = app.ws.table(made.table)?.name ?? link.name;
		showToast(words.imported(made.added, name), () =>
			applyWithUndo(deleteRecords(app.ws, [made.table]), tableWords.tableDeleted(name))
		);
		open = false;
		void goto(tableUrl(made.table));
	}

	function run(): void {
		if (linked) void createLinked();
		else if (records !== null) restore();
		else if (!hasColumns) {
			if (typed) void proceed();
		} else if (into === NEW_TABLE) create();
		else append();
	}
</script>

<Dialog
	bind:open
	title={linked ? (link.preview?.suggested.label ?? words.title) : words.title}
	wide={linked}
	dirty={ready || linked || typed}
	typeOnOpen={false}
	onsubmit={run}
>
	<div class="flex flex-col gap-3" bind:this={body}>
		{#if linked}
			<LinkPreview {link} {bases} bind:base />
		{:else if !ready}
			<input
				bind:this={picker}
				type="file"
				accept=".csv,.tsv,.txt,.json,.xlsx,text/csv,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
				aria-label={words.fileToImport}
				tabindex="-1"
				class="sr-only"
				onchange={(event) => {
					const file = event.currentTarget.files?.[0];
					if (file) void read({ file, into: into || null });
				}}
			/>
			<div class="relative">
				<span class="pointer-events-none absolute inset-y-0 left-2 flex items-center text-ink-3"
					><Icon name="url" /></span
				>
				<input
					class="{input} px-control"
					aria-label={words.fileOrLink}
					placeholder={words.fileOrLink}
					autocapitalize="off"
					spellcheck="false"
					bind:value={link.link}
					onpaste={(event) => {
						const text = event.clipboardData?.getData('text/plain') ?? '';
						// Cells copied from a sheet hold tabs or lines; a link never does.
						if (/[\t\n]/u.test(text.trim())) {
							event.preventDefault();
							void read({ text, into: into || null });
						}
					}}
				/>
				<button
					type="button"
					class="absolute inset-y-0 right-0 flex w-control items-center justify-center text-ink-3 transition-colors motion hover:text-ink"
					aria-label={words.chooseFile}
					onclick={() => picker?.click()}><Icon name="attach" /></button
				>
			</div>
			{#if link.needsKey}
				<p class="text-sm text-ink-2">{words.keyNeeded}</p>
				<LinkKey {link} onretry={() => void link.read().then((read) => (linked = read))} />
			{/if}
		{/if}

		{#if records !== null}
			<p>{summary}</p>
			<p class="text-ink-2">{words.replaces}</p>
		{/if}

		{#if hasColumns}
			<Field label={words.into}>
				<Select
					options={[
						{ value: NEW_TABLE, label: words.newTable, icon: 'plus' },
						...tables.map((table) => ({ value: table.id, label: table.name }))
					]}
					value={into}
					onchange={pickTable}
				/>
			</Field>

			{#if into === NEW_TABLE}
				{#if bases.length > 1}
					<Field label={words.base}>
						<Select
							options={bases.map((item) => ({ value: item.id, label: item.name }))}
							bind:value={base}
						/>
					</Field>
				{/if}
				<Field label={tableWords.tableName}>
					<input class={input} bind:value={tableName} />
				</Field>
			{/if}

			<div class="flex flex-col gap-2">
				<span class="text-sm font-medium text-ink-2"
					>{words.size(columns.length, rows.length - 1)}</span
				>
				<div class="flex flex-col gap-1">
					{#each columns as column, index (index)}
						{#if into === NEW_TABLE}
							<div class="grid grid-cols-3 items-center gap-2">
								<input
									class="{input} col-span-2"
									bind:value={column.name}
									aria-label={words.columnName(index + 1)}
								/>
								<Select
									options={TYPES}
									bind:value={column.type}
									aria-label={words.typeOf(column.name)}
								/>
							</div>
						{:else}
							<div class="grid grid-cols-2 items-center gap-2">
								<span class="flex min-w-0 flex-col">
									<span class="truncate font-medium">{column.name}</span>
									<span class="truncate text-sm text-ink-3">{sample(index)}</span>
								</span>
								<Select
									options={[
										{ value: NEW_FIELD, label: words.newField, icon: 'plus' },
										{ value: SKIP, label: words.skip, icon: 'x' },
										...fields.map((field) => ({
											value: field.id,
											label: field.name,
											icon: fieldIcon(field.type)
										}))
									]}
									bind:value={targets[index]}
									aria-label={words.fieldFor(column.name)}
								/>
							</div>
						{/if}
					{/each}
				</div>
			</div>
		{/if}

		{#if problem || link.problem}
			<p class="rounded-box bg-tint p-2" role="alert">{problem || link.problem}</p>
		{/if}
	</div>

	{#snippet footer()}
		<div class="flex-1"></div>
		{#if linked}
			<Button variant="ghost" onclick={() => (linked = false)}>{common.back}</Button>
			<Button variant="primary" disabled={link.busy} onclick={run}>{common.create}</Button>
		{:else if !ready}
			<Button variant="primary" disabled={!typed || link.busy || link.needsKey} onclick={run}
				>{words.continue}</Button
			>
		{:else}
			<Button variant="primary" onclick={run}
				>{records === null ? words.import : words.restore}</Button
			>
		{/if}
	{/snippet}
</Dialog>
