<script lang="ts">
	import type { Component } from 'svelte';
	import { onMount, tick } from 'svelte';

	import Button from '#lib/ui/Button.svelte';
	import Segmented from '#lib/ui/Segmented.svelte';

	import { EXAMPLES, choiceIndex, sentences, type Example, type ViewStep } from './examples.ts';
	import { fly, readCells } from './flight.ts';
	import ReplicaViews from './ReplicaViews.svelte';

	type RealView = 'grid' | 'entry' | 'list' | 'chart';
	type Real = Component<{
		exampleId: string;
		name: RealView;
		onrows: (count: number) => void;
		onready: () => void;
	}>;

	const REAL_VIEWS: { id: RealView; label: string }[] = [
		{ id: 'grid', label: 'Grid' },
		{ id: 'entry', label: 'Entry' },
		{ id: 'list', label: 'List' },
		{ id: 'chart', label: 'Chart' }
	];

	let example = $state<Example>(EXAMPLES[0]);
	let step = $state(0);
	let mode = $state<'blank' | RealView>('blank');
	let hasColumn = $state(false);
	let ghostColumn = $state(false);
	let tabs = $state<ViewStep[]>([]);
	let ghostTab = $state<ViewStep | null>(null);
	let proposal = $state('');
	let pressed = $state(false);

	let RealTable = $state<Real | null>(null);
	let realOn = $state(false);
	let realReady = $state(false);
	let realView = $state<RealView>('grid');
	let realRows = $state(0);

	let body = $state<HTMLElement>();
	let canvas = $state<HTMLCanvasElement>();
	let script = 0;

	const reduced = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;
	const wait = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

	const allTabs = $derived(ghostTab === null ? tabs : [...tabs, ghostTab]);
	const chartSpec = $derived(
		allTabs.find((tab): tab is Extract<ViewStep, { view: 'chart' }> => tab.view === 'chart') ?? null
	);
	const listGroup = $derived(
		allTabs.find((tab): tab is Extract<ViewStep, { view: 'list' }> => tab.view === 'list')?.group ??
			choiceIndex(example)
	);

	const viewItems = $derived(
		realOn
			? REAL_VIEWS.map((view) => ({
					id: view.id,
					label: view.label,
					active: realView === view.id,
					onclick: () => goReal(view.id)
				}))
			: [
					{ id: 'grid', label: 'Grid', active: mode === 'grid', onclick: () => goReal('grid') },
					...allTabs.map((tab) => ({
						id: tab.view,
						label: tab.name,
						active: mode === tab.view,
						onclick: () => goReal(tab.view)
					}))
				]
	);

	function setState(index: number, before: boolean): void {
		const done = before ? index - 1 : index;
		step = index;
		hasColumn = done >= 1;
		ghostColumn = false;
		tabs = [...(done >= 2 ? [example.first] : []), ...(done >= 3 ? [example.second] : [])];
		ghostTab = null;
		proposal = '';
		pressed = false;
		mode =
			done < 0
				? 'blank'
				: done === 2
					? example.first.view
					: done === 3
						? example.second.view
						: 'grid';
	}

	async function moveTo(next: RealView): Promise<void> {
		const from = reduced() || body === undefined ? [] : readCells(body);
		mode = next;
		await tick();
		if (from.length > 0 && body !== undefined && canvas !== undefined) {
			fly(canvas, from, readCells(body));
		}
	}

	/** One sentence and what it does: the result is proposed, then accepted. */
	async function runStep(index: number, live: () => boolean): Promise<boolean> {
		setState(index, true);
		await wait(Math.max(900, sentences(example)[index].length * 16));
		if (!live()) return false;
		if (index === 0) {
			proposal = `Proposed table: ${example.table}, ${example.fields.length} fields, ${example.rows.length} rows`;
		} else if (index === 1) {
			ghostColumn = true;
		} else {
			const view = index === 2 ? example.first : example.second;
			ghostTab = view;
			proposal = `Proposed view: ${view.name}`;
			await moveTo(view.view);
		}
		await wait(1300);
		if (!live()) return false;
		pressed = true;
		await wait(180);
		if (!live()) return false;
		setState(index, false);
		return true;
	}

	async function play(from: number, to: number): Promise<void> {
		const id = (script += 1);
		const live = (): boolean => script === id;
		if (reduced()) {
			setState(to, false);
			return;
		}
		for (let index = from; index <= to; index++) {
			if (!(await runStep(index, live))) return;
			if (index < to) {
				await wait(1100);
				if (!live()) return;
			}
		}
	}

	function pickExample(next: Example): void {
		realOn = false;
		example = next;
		void play(0, 3);
	}

	function pickStep(index: number): void {
		realOn = false;
		void play(index, index);
	}

	async function goReal(view: RealView): Promise<void> {
		script += 1;
		setState(3, false);
		realView = view;
		realOn = true;
		if (RealTable === null) {
			const module = await import('./RealTable.svelte');
			RealTable = module.default as unknown as Real;
		}
	}

	onMount(() => {
		if (body === undefined) return;
		const root = body;
		if (reduced()) {
			setState(3, false);
			return;
		}
		const seen = new IntersectionObserver(
			(entries) => {
				if (entries[0].isIntersecting) {
					seen.disconnect();
					void play(0, 3);
				}
			},
			{ threshold: 0.3 }
		);
		seen.observe(root);
		return () => {
			script += 1;
			seen.disconnect();
		};
	});

	const pickButton =
		'flex items-center justify-between gap-3 rounded-panel bg-raised px-4 py-2.5 text-left shadow-raised transition-shadow motion hover:ring-1 hover:ring-ink-3 max-lg:py-2';
</script>

<section
	class="flex flex-col overflow-hidden rounded-panel bg-raised text-base shadow-raised {realOn
		? 'h-stage-real max-lg:h-stage-real-narrow'
		: 'h-stage max-lg:h-stage-narrow'}"
	aria-label="An excerpt of the assistant in the app"
	data-testid="stage"
>
	<div
		class="flex shrink-0 hide-scrollbar gap-1 overflow-x-auto p-2 pb-0"
		role="group"
		aria-label="Examples"
	>
		{#each EXAMPLES as item (item.id)}
			<button
				type="button"
				class="h-9 shrink-0 rounded-box px-3.5 font-semibold transition-colors motion {item.id ===
				example.id
					? 'bg-fill text-on-fill'
					: 'bg-tint text-ink-2 hover:bg-tint-2 hover:text-ink'}"
				aria-pressed={item.id === example.id}
				onclick={() => pickExample(item)}>{item.label}</button
			>
		{/each}
	</div>

	<div
		class="m-2 flex h-15 shrink-0 items-center gap-3 overflow-hidden rounded-panel bg-tint py-2 pr-2 pl-3 text-lg leading-snug max-lg:h-36 max-lg:flex-col max-lg:items-start max-lg:gap-1 max-lg:px-2.5"
	>
		<p class="min-w-0 flex-1" data-testid="sentence">
			{realOn ? 'Your turn. This table works.' : sentences(example)[step]}
		</p>
		<div class="flex shrink-0 gap-0.5" role="group" aria-label="Steps">
			{#each [0, 1, 2, 3] as index (index)}
				<button
					type="button"
					class="size-7 rounded-box text-sm font-semibold transition-colors motion max-lg:h-6 {index ===
						step && !realOn
						? 'bg-raised text-ink shadow-raised'
						: 'text-ink-2 hover:bg-tint-2 hover:text-ink'}"
					aria-label="Step {index + 1}"
					aria-pressed={index === step && !realOn}
					onclick={() => pickStep(index)}>{index + 1}</button
				>
			{/each}
		</div>
	</div>

	<div class="flex min-h-10 shrink-0 items-center gap-2.5 px-3 pb-1.5">
		{#if mode === 'blank' && !realOn}
			<span class="text-lg font-semibold tight">Untitled sheet</span>
		{:else}
			<span class="truncate text-lg font-semibold tight">{example.table}</span>
			<span class="pt-0.5 text-sm text-ink-2 max-lg:hidden" data-testid="row-count"
				>{realOn && realReady ? realRows : example.rows.length} rows</span
			>
			<Segmented label="Views" class="ml-auto" items={viewItems} />
		{/if}
	</div>

	{#if proposal !== '' && !realOn}
		<div class="flex shrink-0 items-center gap-2 bg-tint-2 p-1.5 pl-3" data-testid="proposal">
			<span class="min-w-0 flex-1 truncate font-medium">{proposal}</span>
			<Button
				variant="primary"
				class="transition-opacity {pressed ? 'opacity-60' : ''}"
				tabindex={-1}
				aria-hidden="true">Accept</Button
			>
			<Button tabindex={-1} aria-hidden="true">Reject</Button>
		</div>
	{/if}

	{#if realOn && RealTable !== null}
		<RealTable
			exampleId={example.id}
			name={realView}
			onrows={(count) => (realRows = count)}
			onready={() => (realReady = true)}
		/>
	{:else}
		<div
			bind:this={body}
			class="relative min-h-0 flex-1 overflow-hidden"
			onpointerdown={() => {
				if (mode !== 'blank') void goReal(mode === 'grid' ? 'grid' : mode);
			}}
			role="presentation"
			data-testid="replica"
		>
			{#key `${example.id}:${mode}`}
				<div class="h-full enter">
					<ReplicaViews
						{example}
						{mode}
						{hasColumn}
						{ghostColumn}
						{pressed}
						chart={chartSpec}
						group={listGroup}
					/>
				</div>
			{/key}
			<canvas
				bind:this={canvas}
				class="pointer-events-none absolute inset-0 size-full"
				aria-hidden="true"
			></canvas>
		</div>
	{/if}

	<p class="shrink-0 border-t border-hair px-3.5 py-2 text-sm text-ink-2">
		{#if realOn}
			The real app, running in this page on sample data. Nothing leaves your browser.
		{:else}
			Excerpt of the assistant in the app, on sample data. The assistant needs an account.
		{/if}
	</p>
</section>

<div
	class="grid grid-cols-4 gap-2 max-lg:grid-cols-2 max-lg:gap-1.5"
	role="group"
	aria-label="Views"
>
	{#each REAL_VIEWS as view (view.id)}
		<button
			type="button"
			class="{pickButton} {(realOn ? realView : mode) === view.id ? 'ring-2 ring-ink' : ''}"
			aria-pressed={(realOn ? realView : mode) === view.id}
			onclick={() => goReal(view.id)}
		>
			<span class="text-lg font-semibold tight">{view.label}</span>
			<svg
				viewBox="0 0 56 36"
				class="h-9 w-14 shrink-0 fill-current text-ink-2 max-lg:h-7 max-lg:w-11"
				aria-hidden="true"
			>
				{#if view.id === 'grid'}
					<rect width="56" height="6" opacity=".5" />
					<rect y="10" width="24" height="4" />
					<rect x="30" y="10" width="26" height="4" />
					<rect y="18" width="24" height="4" />
					<rect x="30" y="18" width="26" height="4" />
					<rect y="26" width="24" height="4" />
					<rect x="30" y="26" width="26" height="4" />
				{:else if view.id === 'entry'}
					<rect x="14" width="28" height="4" opacity=".5" />
					<rect x="14" y="8" width="28" height="14" />
					<rect x="14" y="26" width="28" height="10" opacity=".5" />
				{:else if view.id === 'list'}
					<rect width="14" height="4" opacity=".5" />
					<rect y="7" width="56" height="6" />
					<rect y="15" width="56" height="6" />
					<rect y="24" width="14" height="4" opacity=".5" />
					<rect y="30" width="56" height="6" />
				{:else}
					<rect y="18" width="11" height="18" />
					<rect x="15" y="8" width="11" height="28" />
					<rect x="30" y="22" width="11" height="14" />
					<rect x="45" width="11" height="36" />
				{/if}
			</svg>
		</button>
	{/each}
</div>
