<script lang="ts">
	import { onMount } from 'svelte';

	import { app } from '#lib/client/app.svelte.ts';
	import Chart from '#lib/views/Chart.svelte';
	import Entry from '#lib/views/Entry.svelte';
	import Grid from '#lib/views/Grid.svelte';
	import List from '#lib/views/List.svelte';
	import Toast from '#lib/views/Toast.svelte';

	import { fly, readCells, type FlightCell } from './flight.ts';
	import { seedExamples, type SampleViews } from './seed.ts';

	let {
		exampleId,
		name,
		onrows,
		onready
	}: {
		exampleId: string;
		name: 'grid' | 'entry' | 'list' | 'chart';
		onrows: (count: number) => void;
		onready: () => void;
	} = $props();

	let samples = $state<Record<string, SampleViews> | null>(null);
	let box = $state<HTMLElement>();
	let canvas = $state<HTMLCanvasElement>();
	let before: FlightCell[] = [];
	let shown: string | null = null;

	const sample = $derived(samples?.[exampleId]);

	const view = $derived.by(() => {
		void app.version;
		return sample === undefined
			? undefined
			: app.ws.views(sample.table).find((item) => item.id === sample[name]);
	});

	const reduced = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

	onMount(() => {
		let made: Record<string, SampleViews> | null = null;
		void app
			.openSample((ws, commit) => {
				made = seedExamples(ws, commit);
			})
			.then(() => {
				samples = made;
				onready();
			});
	});

	$effect(() => {
		void app.version;
		if (sample !== undefined) onrows(app.ws.rows(sample.table).length);
	});

	$effect.pre(() => {
		const next = `${exampleId}:${name}`;
		if (next !== shown && box !== undefined && shown !== null && !reduced()) {
			before = readCells(box);
		}
	});

	$effect(() => {
		const next = `${exampleId}:${name}`;
		if (next === shown || view === undefined) return;
		const sameExample = shown?.startsWith(`${exampleId}:`) ?? false;
		shown = next;
		const from = before;
		before = [];
		if (!sameExample || from.length === 0) return;
		requestAnimationFrame(() => {
			if (box !== undefined && canvas !== undefined) fly(canvas, from, readCells(box));
		});
	});
</script>

<div class="relative min-h-0 flex-1" data-testid="real-table">
	<div bind:this={box} class="h-full overflow-auto">
		{#if sample !== undefined && view !== undefined}
			{#key view.id}
				<div class="h-full enter">
					{#if view.type === 'grid'}
						<Grid tableId={sample.table} {view} />
					{:else if view.type === 'entry'}
						<Entry tableId={sample.table} {view} />
					{:else if view.type === 'list'}
						<List tableId={sample.table} {view} />
					{:else}
						<Chart tableId={sample.table} {view} />
					{/if}
				</div>
			{/key}
		{/if}
	</div>
	<canvas
		bind:this={canvas}
		class="pointer-events-none absolute inset-0 size-full"
		aria-hidden="true"
	></canvas>
	<Toast />
</div>
