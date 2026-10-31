<script lang="ts">
	import Chip from '#lib/ui/Chip.svelte';
	import { swatch } from '#lib/ui/colors.ts';
	import Icon from '#lib/ui/Icon.svelte';
	import Stepper from '#lib/ui/Stepper.svelte';

	import {
		choiceIndex,
		colorOf,
		numberIndex,
		type Cell,
		type Example,
		type ViewStep
	} from './examples.ts';

	type Mode = 'blank' | 'grid' | 'entry' | 'list' | 'chart';

	let {
		example,
		mode,
		hasColumn,
		ghostColumn,
		pressed,
		chart,
		group
	}: {
		example: Example;
		mode: Mode;
		hasColumn: boolean;
		ghostColumn: boolean;
		pressed: boolean;
		chart: Extract<ViewStep, { view: 'chart' }> | null;
		group: number;
	} = $props();

	const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
	const shown = (value: Cell): string =>
		typeof value === 'number' ? number.format(value) : String(value);

	const choice = $derived(choiceIndex(example));
	const amountAt = $derived(numberIndex(example));
	const lastRow = $derived(example.rows[example.rows.length - 1]);

	const groups = $derived(
		(example.fields[group]?.choices ?? [])
			.map((item) => ({
				...item,
				rows: example.rows.filter((row) => row[group] === item.name)
			}))
			.filter((item) => item.rows.length > 0)
	);

	const bars = $derived.by(() => {
		if (chart === null)
			return {
				total: 0,
				list: [] as { key: string; parts: { color: string; height: number }[] }[]
			};
		const spec = chart;
		const amount = (row: Cell[]): number => (spec.value === null ? 1 : Number(row[spec.value]));
		const keys = [...new Set(example.rows.map((row) => String(row[spec.group])))].sort();
		const totals = keys.map((key) =>
			example.rows
				.filter((row) => String(row[spec.group]) === key)
				.reduce((sum, row) => sum + amount(row), 0)
		);
		const tallest = Math.max(...totals, 1);
		return {
			total: totals.reduce((sum, value) => sum + value, 0),
			list: keys.map((key) => {
				const parts = new Map<string, number>();
				for (const row of example.rows) {
					if (String(row[spec.group]) !== key) continue;
					const color = swatch(colorOf(example, row[choice]));
					parts.set(color, (parts.get(color) ?? 0) + amount(row));
				}
				return {
					key,
					parts: [...parts].map(([color, value]) => ({
						color,
						height: (value / tallest) * 100
					}))
				};
			})
		};
	});

	const head = 'h-8 border-b border-hair px-2.5 text-left text-sm font-medium text-ink-2';
	const cell = 'h-row max-w-0 truncate border-b border-hair px-2.5 max-lg:max-w-none';
	const chipClass =
		'inline-flex h-control shrink-0 items-center gap-2 rounded-box px-3 font-medium';
	const blankCell = 'h-row border border-edge/50 p-0 text-center text-xs font-normal text-ink-2';
</script>

{#if mode === 'blank'}
	<table class="size-full table-fixed border-collapse" data-testid="blank-sheet">
		<thead>
			<tr>
				<th class="{blankCell} w-9 bg-tint"></th>
				{#each ['A', 'B', 'C', 'D'] as letter (letter)}
					<th class="{blankCell} bg-tint">{letter}</th>
				{/each}
				{#each ['E', 'F', 'G'] as letter (letter)}
					<th class="{blankCell} bg-tint max-lg:hidden">{letter}</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each [1, 2, 3, 4, 5, 6, 7, 8] as row (row)}
				<tr class={row > 7 ? 'max-lg:hidden' : ''}>
					<td class="{blankCell} bg-tint">{row}</td>
					<td class="{blankCell} {row === 1 ? 'outline-2 -outline-offset-2 outline-ink' : ''}"></td>
					{#each [1, 2, 3] as column (column)}
						<td class={blankCell}></td>
					{/each}
					{#each [1, 2, 3] as column (column)}
						<td class="{blankCell} max-lg:hidden"></td>
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>
{:else if mode === 'grid'}
	<table class="w-full border-separate border-spacing-0">
		<thead>
			<tr>
				<th class="{head} w-9 max-lg:hidden"><span class="sr-only">Row</span></th>
				{#each example.fields as field (field.name)}
					<th class="{head} {field.type === 'number' ? 'text-right' : ''}">{field.name}</th>
				{/each}
				{#if hasColumn || ghostColumn}
					<th
						class="{head} text-right {ghostColumn ? 'bg-tint text-ink' : ''}"
						data-testid={ghostColumn ? 'ghost-column' : undefined}
					>
						<span class="inline-flex items-center gap-1.5">
							<span class="truncate">ƒ {example.column.name}</span>
							{#if ghostColumn}
								<span
									class="flex size-4 items-center justify-center rounded-box bg-fill text-on-fill transition-opacity motion {pressed
										? 'opacity-60'
										: ''}"><Icon name="check" class="size-3" /></span
								>
								<Icon name="x" class="size-3" />
							{/if}
						</span>
					</th>
				{/if}
			</tr>
		</thead>
		<tbody>
			{#each example.rows as row, index (index)}
				<tr>
					<td class="{cell} text-right text-xs text-ink-2 max-lg:hidden">{index + 1}</td>
					{#each example.fields as field, column (field.name)}
						<td class="{cell} {field.type === 'number' ? 'text-right' : ''}">
							{#if field.type === 'choice'}
								<Chip name={String(row[column])} color={colorOf(example, row[column])} />
							{:else}
								{shown(row[column])}
							{/if}
						</td>
					{/each}
					{#if hasColumn || ghostColumn}
						<td class="{cell} text-right {ghostColumn ? 'bg-tint' : ''}"
							>{shown(example.column.value(row))}</td
						>
					{/if}
				</tr>
			{/each}
		</tbody>
	</table>
{:else if mode === 'entry'}
	<div class="flex h-full flex-col lg:flex-row lg:items-end">
		<ul class="flex min-h-0 flex-1 flex-col justify-end overflow-hidden lg:h-full lg:pb-3">
			{#each example.rows as row, index (index)}
				<li class="flex h-9 shrink-0 items-center justify-between gap-3 px-4">
					<Chip name={String(row[0])} color={colorOf(example, row[choice])} />
					<span>{amountAt < 0 ? row[choice] : shown(row[amountAt])}</span>
				</li>
			{/each}
		</ul>
		<div class="flex shrink-0 flex-col gap-2 p-3 lg:w-entry">
			<div class="flex flex-wrap gap-1">
				{#each example.fields[choice].choices ?? [] as item (item.name)}
					<span
						class="{chipClass} {item.name === lastRow[choice]
							? 'bg-fill text-on-fill'
							: 'bg-tint text-ink-2'}"
					>
						<span class="size-mark rounded-box" style={swatch(item.color)}></span>{item.name}
					</span>
				{/each}
			</div>
			{#if amountAt >= 0}
				<Stepper
					label={example.fields[amountAt].name}
					text={shown(lastRow[amountAt])}
					oninput={() => undefined}
					onstep={() => undefined}
				/>
			{:else}
				<div class="flex h-control items-center rounded-box bg-tint px-3 text-ink-2">
					{example.fields[0].name}
				</div>
			{/if}
			<span
				class="flex h-cta items-center justify-center rounded-box bg-fill text-lg font-semibold text-on-fill"
				>Add row</span
			>
		</div>
	</div>
{:else if mode === 'list'}
	<div class="flex h-full flex-col overflow-hidden">
		{#each groups as item (item.name)}
			<section class="flex flex-col">
				<h4 class="flex items-center gap-2 px-4 pt-2 pb-0.5 text-sm font-medium text-ink-2">
					<Chip name={item.name} color={item.color} />
					<span>{item.rows.length}</span>
				</h4>
				{#each item.rows as row, index (index)}
					<div class="flex items-baseline justify-between gap-3 px-4 py-0.5">
						<span class="truncate font-medium">{row[0]}</span>
						<span class="truncate text-sm text-ink-2">
							{row
								.filter((_, column) => column !== 0 && column !== group)
								.map(shown)
								.join(', ')}
						</span>
					</div>
				{/each}
			</section>
		{/each}
	</div>
{:else if chart !== null}
	<div class="flex h-full flex-col px-4 pb-3">
		<span class="font-medium text-ink-2">{chart.label}</span>
		<p class="text-hero leading-tight font-semibold tighter">{number.format(bars.total)}</p>
		<p class="text-ink-2">{chart.by}</p>
		<div class="mt-2 grid min-h-0 flex-1 auto-cols-fr grid-flow-col items-end gap-3">
			{#each bars.list as bar (bar.key)}
				<div class="flex h-full min-w-0 flex-col-reverse gap-px">
					{#each bar.parts as part, index (index)}
						<div data-cell style="{part.color}; height: {part.height}%"></div>
					{/each}
				</div>
			{/each}
		</div>
		<div class="grid auto-cols-fr grid-flow-col gap-3 pt-1 text-xs text-ink-2">
			{#each bars.list as bar (bar.key)}
				<span class="truncate text-center">{bar.key}</span>
			{/each}
		</div>
	</div>
{/if}
