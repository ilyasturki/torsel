<script lang="ts">
	const ROWS: { want: string; sheet: string; torsel: string }[] = [
		{
			want: 'A new tracker',
			sheet: 'Name columns, set formats, build dropdowns',
			torsel: '“Make me a budget”'
		},
		{
			want: 'A computed column',
			sheet: '=D2*IF(C2="Won",1,IF(C2="Talking",0.5,0.2))',
			torsel: '“Add the expected value”'
		},
		{
			want: 'A chart',
			sheet: 'Pivot table, insert chart, pick the ranges',
			torsel: '“Chart the pipeline”'
		},
		{ want: 'On your phone', sheet: 'Pinch, scroll, tap a tiny cell', torsel: 'A form, prefilled' }
	];

	const head = 'pr-2 text-left text-sm font-medium text-ink-2';
	const box = 'flex h-10 items-center';
</script>

<table
	class="w-full border-separate border-spacing-y-1.5 text-lede max-lg:block max-lg:border-spacing-0"
>
	<thead class="max-lg:hidden">
		<tr>
			<th class={head}><span class="sr-only">You want</span></th>
			<th class={head}>In a spreadsheet</th>
			<th class={head}>In Torsel</th>
		</tr>
	</thead>
	<tbody class="max-lg:block">
		{#each ROWS as row (row.want)}
			<tr
				class="max-lg:block max-lg:border-t max-lg:border-hair max-lg:py-2 max-lg:first:border-t-0"
			>
				<td class="pr-2 font-semibold max-lg:block max-lg:pb-1 lg:w-1/5">{row.want}</td>
				<td class="pr-2 max-lg:block max-lg:pb-1">
					<div
						class="{box} hide-scrollbar overflow-x-auto border border-edge/50 px-2.5 font-mono text-sm whitespace-nowrap text-ink-2"
					>
						{row.sheet}
					</div>
				</td>
				<td class="max-lg:block lg:w-2/5">
					<div class="{box} rounded-panel bg-tint px-3 font-medium">{row.torsel}</div>
				</td>
			</tr>
		{/each}
	</tbody>
</table>
