<script lang="ts">
	import Button from '#lib/ui/Button.svelte';
	import Chip from '#lib/ui/Chip.svelte';
	import { swatch } from '#lib/ui/colors.ts';
	import Icon from '#lib/ui/Icon.svelte';

	const COLUMN = [
		{ name: 'Acme', stage: 'Won', color: 'green', value: '12,000', expected: '12,000' },
		{ name: 'Delta', stage: 'Talking', color: 'blue', value: '20,000', expected: '10,000' },
		{ name: 'Cedar', stage: 'Lead', color: 'amber', value: '8,000', expected: '1,600' }
	];
	const BARS: { color: string; height: string }[] = [
		{ color: 'amber', height: 'h-10' },
		{ color: 'blue', height: 'h-17' },
		{ color: 'green', height: 'h-8' },
		{ color: 'gray', height: 'h-2' }
	];

	const panel = 'flex flex-col gap-2.5 rounded-panel bg-raised p-4 shadow-raised';
	const title = 'text-lg font-semibold tight';
	const frame = 'overflow-hidden rounded-box text-base ring-1 ring-hair';
	const head = 'h-8 border-b border-hair px-2 text-left text-sm font-medium text-ink-2';
	const cell = 'h-row border-b border-hair px-2 last:border-b-0';
</script>

<div class="grid grid-cols-12 gap-2 max-lg:gap-1.5">
	<div class="{panel} col-span-7 max-lg:col-span-12">
		<h3 class={title}>A column, with its values, before it is yours</h3>
		<div class={frame}>
			<table class="w-full border-separate border-spacing-0">
				<thead>
					<tr>
						<th class={head}>Name</th>
						<th class={head}>Stage</th>
						<th class="{head} text-right">Value</th>
						<th class="{head} bg-tint text-right text-ink">
							<span class="inline-flex items-center gap-1.5">
								ƒ Expected
								<span
									class="flex size-4 items-center justify-center rounded-box bg-fill text-on-fill"
								>
									<Icon name="check" class="size-3" />
								</span>
								<Icon name="x" class="size-3" />
							</span>
						</th>
					</tr>
				</thead>
				<tbody>
					{#each COLUMN as row (row.name)}
						<tr>
							<td class={cell}>{row.name}</td>
							<td class={cell}><Chip name={row.stage} color={row.color} /></td>
							<td class="{cell} text-right">{row.value}</td>
							<td class="{cell} bg-tint text-right">{row.expected}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
	<div class="{panel} col-span-5 max-lg:col-span-12">
		<h3 class={title}>A view, on your live rows</h3>
		<div class={frame}>
			<div class="flex items-center gap-1.5 bg-tint-2 p-1.5 pl-2.5">
				<span class="min-w-0 flex-1 truncate font-medium">Proposed view: Pipeline</span>
				<Button variant="primary" tabindex={-1} aria-hidden="true">Accept</Button>
				<Button tabindex={-1} aria-hidden="true">Reject</Button>
			</div>
			<div class="grid grid-cols-4 items-end gap-3 p-2.5">
				{#each BARS as bar (bar.color)}
					<div class={bar.height} style={swatch(bar.color)}></div>
				{/each}
			</div>
		</div>
	</div>
	<div class="{panel} col-span-4 max-lg:col-span-12">
		<h3 class={title}>Rows, with an undo</h3>
		<div class={frame}>
			<div class="flex h-row items-center justify-between gap-3 bg-tint-2 px-2">
				<span>Fern</span>
				<Chip name="Lead" color="amber" />
				<span>6,000</span>
			</div>
			<div
				class="m-2 flex h-control items-center justify-between rounded-panel bg-fill pr-1 pl-3 text-on-fill"
			>
				<span>Row added</span>
				<span class="px-2 font-semibold">Undo</span>
			</div>
		</div>
	</div>
	<div class="{panel} col-span-8 max-lg:col-span-12">
		<h3 class={title}>The same tools, from any MCP client</h3>
		<pre
			class="overflow-x-auto rounded-panel bg-tint px-3.5 py-3 font-mono text-sm leading-relaxed text-ink-2"><span
				class="text-ink">claude mcp add</span
			> --transport http torsel \
  https://your-instance/api/mcp \
  --header "Authorization: Bearer ts_..."</pre>
	</div>
</div>
