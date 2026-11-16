<script lang="ts">
	import { app } from '#lib/client/app.svelte.ts';
	import { formatDate, formatNumber, readNumber } from '#lib/client/format.ts';
	import { loggedThrough } from '#lib/client/place.ts';
	import { showToast } from '#lib/client/toast.svelte.ts';
	import { defaultMatch, doneRows, entryFields, insertRows } from '#lib/core/actions.ts';
	import { blank, entryPlan, nextLine, repeats, sameValue } from '#lib/core/entry.ts';
	import type { PlanLine } from '#lib/core/entry.ts';
	import type { FieldDef, Rec, Value, ViewDef } from '#lib/core/model.ts';
	import { isDated, isNumeric } from '#lib/core/model.ts';
	import { nativeDateText, nowIso, parseDate, todayIso } from '#lib/core/values.ts';
	import { createdAt } from '#lib/core/workspace.ts';
	import Rich from '#lib/i18n/Rich.svelte';
	import { table as tableWords } from '#lib/i18n/table.ts';
	import { views as words } from '#lib/i18n/views.ts';
	import Button from '#lib/ui/Button.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import { roomy } from '#lib/ui/media.svelte.ts';
	import Stepper from '#lib/ui/Stepper.svelte';
	import { focus, input } from '#lib/ui/styles.ts';

	import CellValue from './CellValue.svelte';
	import EntryKey from './EntryKey.svelte';
	import FieldInput from './FieldInput.svelte';
	import RowSheet from './RowSheet.svelte';

	let { tableId, view }: { tableId: string; view: ViewDef } = $props();

	const MANY = 12;
	const FREE = 'free';

	const all = $derived.by(() => {
		void app.version;
		return app.ws.fields(tableId);
	});

	const fields = $derived(entryFields(all, view.config));

	const logged = $derived.by(() => {
		void app.version;
		return app.ws.rows(tableId);
	});

	const keys = $derived(
		(view.config.match ?? defaultMatch(fields, logged))
			.map((id) => fields.find((field) => field.id === id))
			.filter((field) => field !== undefined)
	);
	const keyIds = $derived(new Set(keys.map((field) => field.id)));
	const grouping = $derived(keys.length > 1 ? keys[0] : undefined);
	const items = $derived(grouping === undefined ? keys : keys.slice(1));
	const dateField = $derived(fields.find((field) => isDated(field.type) && !keyIds.has(field.id)));
	const others = $derived(
		fields
			.filter((field) => !keyIds.has(field.id) && field.id !== dateField?.id)
			.sort((a, b) => Number(isNumeric(b.type)) - Number(isNumeric(a.type)))
	);
	const steppers = $derived(others.filter((field) => field.type === 'number'));
	const rest = $derived(others.filter((field) => field.type !== 'number'));
	const typed = $derived(rest.filter((field) => !copied.has(field.id)));
	const picked = $derived(rest.filter((field) => copied.has(field.id)));
	const columns = $derived(others.filter((field) => isNumeric(field.type)));

	let values = $state<Record<string, Value>>({});
	let edits = $state<Record<string, Value>>({});
	let texts = $state<Record<string, string>>({});
	let chosen = $state<string | null>(null);
	let started = false;
	let rowOpen = $state(false);
	let rowId = $state<string | null>(null);

	const today = todayIso();

	function dayOf(row: Rec): string {
		const value = dateField === undefined ? undefined : row.data[dateField.id];
		return typeof value === 'string' ? value.slice(0, 10) : todayIso(new Date(createdAt(row)));
	}

	const ordered = $derived(
		[...logged].sort((a, b) => dayOf(b).localeCompare(dayOf(a)) || createdAt(b) - createdAt(a))
	);

	const done = $derived(doneRows(others, ordered));
	const copied = $derived(
		new Set(others.filter((field) => repeats(field, logged)).map((f) => f.id))
	);

	$effect(() => {
		if (started || !app.ready) return;
		started = true;
		for (const field of keys) {
			const keyed = (row: Rec): boolean => !blank(row.data[field.id]);
			const latest =
				ordered.find((row) => keyed(row) && done(row)) ?? ordered.find((row) => keyed(row));
			values[field.id] = latest?.data[field.id] ?? null;
		}
	});

	const plan = $derived(
		grouping === undefined || blank(values[grouping.id])
			? null
			: entryPlan(logged, {
					group: grouping,
					value: values[grouping.id],
					items,
					dayOf,
					today,
					done
				})
	);

	const line = $derived.by((): PlanLine | undefined => {
		if (plan === null || chosen === FREE) return undefined;
		const open = plan.groups
			.flatMap((group) => group.lines)
			.find((candidate) => candidate.planned?.id === chosen && candidate.logged === null);
		return open ?? nextLine(plan);
	});

	function keyValue(field: FieldDef): Value {
		if (line?.planned != null && field.id !== grouping?.id) {
			return line.planned.data[field.id] ?? null;
		}
		return values[field.id] ?? null;
	}

	const last = $derived(
		ordered.find(
			(row) => done(row) && keys.every((field) => sameValue(row.data[field.id], values[field.id]))
		)
	);

	const template = $derived(line?.planned ?? last);

	function shown(field: FieldDef): Value {
		if (field.id in edits) return edits[field.id] ?? null;
		return copied.has(field.id) ? (template?.data[field.id] ?? null) : null;
	}

	function set(field: FieldDef, value: Value): void {
		edits[field.id] = value;
	}

	function pick(field: FieldDef, value: Value): void {
		values[field.id] = value;
		if (field.id === grouping?.id) chosen = null;
	}

	function choose(next: PlanLine): void {
		if (next.logged !== null) {
			open(next.logged);
		} else if (next.planned !== null) {
			chosen = next.planned.id;
			edits = {};
			texts = {};
		}
	}

	function open(row: Rec): void {
		rowId = row.id;
		rowOpen = true;
	}

	function stamp(field: FieldDef): string {
		return field.type === 'datetime' ? nowIso() : todayIso();
	}

	function step(field: FieldDef, direction: number): void {
		const size = field.step ?? 1;
		const current = shown(field);
		const base = typeof current === 'number' ? current : 0;
		const next = Math.max(0, Math.round((base + direction * size) * 1000) / 1000);
		set(field, next);
		texts[field.id] = formatNumber(next, { edit: true });
	}

	function recentOf(field: FieldDef): string[] {
		const seen = new Set<string>();
		for (const row of [...ordered.filter(done), ...ordered]) {
			const value = row.data[field.id];
			if (typeof value === 'string') seen.add(value);
			if (seen.size >= MANY) break;
		}
		return [...seen];
	}

	const ready = $derived(keys.every((field) => !blank(keyValue(field))));

	// A table filled by a source takes no rows from here: its history stays to open.
	const adds = $derived.by(() => {
		void app.version;
		return app.canAddRows(tableId);
	});

	let lastAdded = { at: 0, row: '' };

	function commit(): void {
		const row: Record<string, Value> = {};
		for (const field of keys) row[field.id] = keyValue(field);
		if (dateField !== undefined) row[dateField.id] = values[dateField.id] ?? stamp(dateField);
		for (const field of others) row[field.id] = shown(field);

		// A double tap would log the same set twice; quick taps through a plan log a new set each.
		const same = JSON.stringify(Object.entries(row).filter(([id]) => id !== dateField?.id));
		if (same === lastAdded.row && Date.now() - lastAdded.at < 500) return;
		lastAdded = { at: Date.now(), row: same };

		const { changes } = insertRows(app.ws, tableId, [row]);
		const group = app.apply(changes, tableWords.rowAdded);
		loggedThrough(tableId, view.id);
		for (const field of items) values[field.id] = row[field.id];
		if (chosen !== FREE) chosen = null;
		edits = {};
		texts = {};
		showToast(tableWords.rowAdded, group?.id ?? null);
	}

	const when = (row: Rec): string | null => (dayOf(row) === today ? null : formatDate(dayOf(row)));

	const history = $derived(
		ordered
			.filter((row) =>
				keys.every(
					(field) => blank(values[field.id]) || sameValue(row.data[field.id], values[field.id])
				)
			)
			.slice(0, 20)
			.map((row, at, list) => {
				const day = dayOf(row);
				const shownDay =
					at > 0 && dayOf(list[at - 1]) === day
						? ''
						: day === today
							? words.today
							: formatDate(day);
				return { row, day: shownDay };
			})
	);

	const filters = $derived(keys.filter((field) => !blank(values[field.id])));

	const lead = $derived(
		keys.find((field) => blank(values[field.id])) ??
			rest.find((field) => field.type === 'text' || field.type === 'longtext')
	);

	const lines = $derived(plan?.groups.flatMap((group) => group.lines) ?? []);
	const span = $derived(roomy.current ? columns.length * 2 : columns.length);

	function revealLine(node: HTMLElement, on: boolean): { update(on: boolean): void } {
		const show = (now: boolean): void => {
			if (now) node.scrollIntoView({ block: 'nearest' });
		};
		show(on);
		return { update: show };
	}

	const gridOf = (count: number): string =>
		`grid-template-columns: var(--spacing-control) repeat(${count}, minmax(0, ${roomy.current ? '7rem' : '1fr'}))`;
</script>

{#snippet other(field: FieldDef)}
	<div class="flex items-center gap-3">
		<label for="entry-{field.id}" class="w-24 shrink-0 truncate text-ink-2">{field.name}</label>
		<div class="min-w-0 flex-1">
			<FieldInput
				id="entry-{field.id}"
				{field}
				bind:value={() => shown(field), (next) => set(field, next ?? null)}
			/>
		</div>
	</div>
{/snippet}

{#snippet cells(row: Rec | null)}
	{#each columns as field (field.id)}
		<span class="truncate px-2 text-right">
			{#if row !== null}<CellValue {field} value={row.data[field.id]} />{/if}
		</span>
	{/each}
{/snippet}

{#if fields.length === 0}
	<Empty text={words.noEntryFields} />
{:else}
	<div
		class="flex h-full min-h-0 flex-col lg:grid lg:grid-rows-[auto_minmax(0,1fr)] {adds
			? 'lg:grid-cols-[minmax(0,1fr)_var(--spacing-entry)]'
			: 'lg:grid-cols-1'}"
	>
		{#if grouping !== undefined}
			<section
				class="shrink-0 border-b border-rule px-4 pt-3 pb-3 lg:col-start-2 lg:row-start-1 lg:border-l lg:pt-4"
			>
				<EntryKey
					field={grouping}
					value={values[grouping.id] ?? null}
					recent={recentOf(grouping)}
					onpick={(next) => pick(grouping, next)}
				/>
			</section>
		{/if}

		{#if plan !== null}
			<div
				class="min-h-0 flex-1 overflow-auto lg:col-start-1 lg:row-span-2 lg:row-start-1"
				role="group"
				aria-label={words.lastTime}
			>
				<div class="grid text-ink-2" style={gridOf(span)}>
					<div class="sticky top-0 z-10 col-span-full grid grid-cols-subgrid bg-raised">
						{#if roomy.current}
							<span></span>
							<span
								class="flex h-row items-center border-b border-rule px-2 text-sm font-medium text-ink-3"
								style="grid-column: span {columns.length}">{formatDate(plan.day)}</span
							>
							<span
								class="flex h-row items-center border-b border-l border-rule px-2 text-sm font-medium text-ink"
								style="grid-column: span {columns.length}">{words.today}</span
							>
						{/if}
						<span class="border-b border-rule"></span>
						{#each roomy.current ? [...columns, ...columns] : columns as field, at (`${field.id}-${at}`)}
							<span
								class="flex h-row items-center justify-end truncate border-b border-rule px-2 text-sm font-medium text-ink-3 {roomy.current &&
								at === columns.length
									? 'border-l'
									: ''}">{field.name}</span
							>
						{/each}
					</div>
					{#each plan.groups as group (group.key)}
						<div
							class="col-span-full flex min-h-row items-center gap-2 border-b border-rule bg-band px-4 font-medium text-ink"
						>
							{#each items as field (field.id)}
								<CellValue {field} value={group.row.data[field.id]} />
							{/each}
						</div>
						{#each group.lines as item, at (item.planned?.id ?? item.logged?.id ?? at)}
							{@const on = item === line}
							<button
								type="button"
								class="col-span-full grid min-h-row grid-cols-subgrid items-center border-b border-rule text-left transition-colors motion {focus} {on
									? 'bg-selected text-ink mark-selected'
									: item.logged !== null
										? 'text-ink hover:bg-tint'
										: 'hover:bg-tint'}"
								aria-pressed={on}
								use:revealLine={on}
								onclick={() => choose(item)}
							>
								<span class="flex justify-center text-ink-2">
									{#if item.logged !== null}<Icon name="check" label={words.logged} />{/if}
								</span>
								{#if roomy.current}
									{@render cells(item.planned)}
									<span class="contents">{@render cells(item.logged)}</span>
								{:else}
									{@render cells(item.logged ?? item.planned)}
								{/if}
							</button>
						{/each}
					{/each}
					<button
						type="button"
						class="col-span-full flex min-h-row items-center gap-2 px-4 text-left transition-colors motion hover:bg-tint {focus} {chosen ===
						FREE
							? 'bg-selected text-ink mark-selected'
							: ''}"
						aria-pressed={chosen === FREE}
						onclick={() => {
							chosen = FREE;
						}}
					>
						<Icon name="plus" />{words.pickAnother(items.map((field) => field.name).join(', '))}
					</button>
				</div>
			</div>
		{:else}
			<div
				class="min-h-0 flex-1 overflow-auto lg:col-start-1 lg:row-span-2 lg:row-start-1"
				role="group"
				aria-label={words.lastTime}
			>
				{#if filters.length > 0}
					<p
						class="flex min-h-row items-center gap-2 border-b border-rule px-4"
						data-testid="entry-filter"
					>
						{#each filters as field (field.id)}
							<span class="text-sm text-ink-3">{field.name}</span>
							<CellValue {field} value={values[field.id]} />
						{/each}
					</p>
				{/if}
				{#if history.length > 0}
					<div
						class="sticky top-0 z-10 flex h-row items-center gap-3 border-b border-rule bg-band px-4 text-sm font-medium text-ink-3"
					>
						<span class="w-16 shrink-0 truncate">{dateField?.name ?? ''}</span>
						<span class="min-w-0 flex-1 truncate">{lead?.name ?? ''}</span>
						{#each columns as field (field.id)}
							<span class="w-14 shrink-0 truncate text-right">{field.name}</span>
						{/each}
					</div>
				{/if}
				<ul class="flex flex-col">
					{#each history as { row, day } (row.id)}
						<li>
							<button
								type="button"
								class="flex min-h-row w-full items-center gap-3 border-b border-rule px-4 text-left transition-colors motion hover:bg-tint {focus}"
								onclick={() => open(row)}
							>
								<span class="w-16 shrink-0 truncate text-ink-2">{day}</span>
								<span class="min-w-0 flex-1 truncate">
									{#if lead !== undefined}<CellValue field={lead} value={row.data[lead.id]} />{/if}
								</span>
								{#each columns as field (field.id)}
									<span class="w-14 shrink-0 truncate text-right tabular-nums"
										><CellValue {field} value={row.data[field.id]} /></span
									>
								{/each}
							</button>
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if adds}
			<section
				class="flex shrink-0 flex-col gap-3 border-t border-rule p-4 lg:col-start-2 lg:border-t-0 lg:border-l {grouping ===
				undefined
					? 'lg:row-span-2 lg:row-start-1'
					: 'lg:row-start-2'}"
			>
				{#if line?.planned != null && plan !== null}
					<p class="flex min-h-control items-center gap-2">
						{#each items as field (field.id)}
							<CellValue {field} value={line.planned.data[field.id]} />
						{/each}
						<button
							type="button"
							class="ml-auto shrink-0 rounded-box text-sm text-ink-3 transition-colors motion hover:text-ink {focus}"
							onclick={() => line?.planned && open(line.planned)}>{formatDate(plan.day)}</button
						>
					</p>
				{:else}
					{#each items as field (field.id)}
						<EntryKey
							{field}
							value={values[field.id] ?? null}
							recent={recentOf(field)}
							onpick={(next) => pick(field, next)}
						/>
					{/each}
					{#if template !== undefined && others.length > 0}
						<p class="text-sm text-ink-3">
							<Rich text={words.from(when(template))}>
								{#snippet row(label: string)}
									<button
										type="button"
										class="rounded-box text-ink-2 underline decoration-edge underline-offset-2 transition-colors motion hover:text-ink hover:decoration-ink {focus}"
										onclick={() => template && open(template)}>{label}</button
									>
								{/snippet}
							</Rich>
						</p>
					{/if}
				{/if}

				{#each typed as field (field.id)}
					{@render other(field)}
				{/each}

				{#if steppers.length > 0}
					{#if roomy.current}
						{#each steppers as field (field.id)}
							{@const value = shown(field)}
							<div class="flex items-center gap-3">
								<span class="min-w-0 flex-1 truncate text-ink-2">{field.name}</span>
								<Stepper
									label={field.name}
									size="xs"
									text={texts[field.id] ??
										(typeof value === 'number' ? formatNumber(value, { edit: true }) : '')}
									oninput={(text) => {
										texts[field.id] = text;
										set(field, readNumber(text));
									}}
									onstep={(direction) => step(field, direction)}
								/>
							</div>
						{/each}
					{:else}
						<div class="grid grid-cols-2 gap-1.5">
							{#each steppers as field, at (field.id)}
								{@const value = shown(field)}
								<div
									class={steppers.length === 1 || (at === steppers.length - 1 && at % 2 === 0)
										? 'col-span-2'
										: ''}
								>
									<Stepper
										label={field.name}
										size={steppers.length === 1 ? 'lg' : 'sm'}
										text={texts[field.id] ??
											(typeof value === 'number' ? formatNumber(value, { edit: true }) : '')}
										oninput={(text) => {
											texts[field.id] = text;
											set(field, readNumber(text));
										}}
										onstep={(direction) => step(field, direction)}
									/>
								</div>
							{/each}
						</div>
					{/if}
				{/if}

				{#each picked as field (field.id)}
					{@render other(field)}
				{/each}

				{#if dateField !== undefined}
					<label class="flex items-center gap-3">
						<span class="w-24 shrink-0 truncate text-ink-2">{dateField.name}</span>
						<input
							class="{input} min-w-0 flex-1"
							type={dateField.type === 'datetime' ? 'datetime-local' : 'date'}
							value={nativeDateText(dateField, values[dateField.id] ?? stamp(dateField))}
							oninput={(event) => {
								if (dateField) values[dateField.id] = parseDate(event.currentTarget.value);
							}}
						/>
					</label>
				{/if}

				<div class="flex-1 max-lg:hidden"></div>
				<Button
					variant="primary"
					size="cta"
					class="sticky bottom-4 z-10 shrink-0 sm:h-control sm:self-end sm:px-3 sm:text-base sm:font-medium"
					disabled={!ready}
					onclick={commit}>{words.addRow}</Button
				>
			</section>
		{/if}
	</div>
	<RowSheet
		bind:open={rowOpen}
		{tableId}
		{rowId}
		order={plan === null ? history.map(({ row }) => row.id) : undefined}
	/>
{/if}
