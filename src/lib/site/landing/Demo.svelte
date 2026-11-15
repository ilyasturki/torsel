<script lang="ts">
	import type { Component } from 'svelte';
	import { onMount, tick } from 'svelte';

	import { app } from '#lib/client/app.svelte.ts';
	import type { ThreadAction } from '#lib/core/thread.ts';
	import Button from '#lib/ui/Button.svelte';
	import Segmented from '#lib/ui/Segmented.svelte';

	import { wave } from './backdrop.ts';
	import { siteCopy } from '#lib/i18n/site.ts';

	import { EXAMPLES, type Example } from './examples.ts';
	import { EXAMPLES_FR } from './examples-fr.ts';
	import type { Sample } from './seed.ts';

	type Live = typeof import('./live.ts');
	type Item = { key: number; text: string; action: ThreadAction | null; view?: string };
	type Thread = { items: Item[]; used: number[]; view: string | undefined };

	let { locale = 'en' }: { locale?: 'en' | 'fr' } = $props();
	// Switching language is a full page load: the dataset is the page's for its whole life.
	// svelte-ignore state_referenced_locally
	const examples = locale === 'fr' ? EXAMPLES_FR : EXAMPLES;
	const t = $derived(siteCopy[locale]);

	let example = $state<Example>(examples[0]);
	let samples = $state<Record<string, Sample> | null>(null);
	let live = $state<Live | null>(null);
	let View = $state<Component<{ tableId: string; viewId: string | undefined }> | null>(null);
	let Toast = $state<Component | null>(null);
	const threads = $state<Record<string, Thread>>({});
	let typed = $state('');
	let busy = $state(false);
	let working = $state(false);
	let key = 0;

	let body = $state<HTMLElement>();
	let scroller = $state<HTMLElement>();

	let openEngine: () => void = () => undefined;
	const engineWanted = new Promise<void>((resolve) => (openEngine = resolve));

	const reduced = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;
	const wait = (ms: number): Promise<void> =>
		new Promise((done) => setTimeout(done, reduced() ? 0 : ms));

	function threadOf(id: string): Thread {
		threads[id] ??= { items: [], used: [], view: undefined };
		return threads[id];
	}

	const thread = $derived(threads[example.id] ?? { items: [], used: [], view: undefined });
	const sample = $derived(samples?.[example.id]);

	const views = $derived.by(() => {
		void app.version;
		return sample === undefined ? [] : app.ws.views(sample.table);
	});
	const viewId = $derived(thread.view ?? views[0]?.id);
	const entryId = $derived(views.find((view) => view.type === 'entry')?.id);
	const rowCount = $derived.by(() => {
		void app.version;
		return sample === undefined ? example.rows.length : app.ws.rows(sample.table).length;
	});
	const left = $derived(
		example.prompts
			.map((prompt, index) => ({ prompt, index }))
			.filter(({ index }) => !thread.used.includes(index))
	);

	/** SQLite loads on the first sign the visitor means to use the table, not with the page. */
	function warm(): Promise<void> {
		openEngine();
		return app.load();
	}

	function show(view: string | undefined): void {
		threadOf(example.id).view = view;
	}

	/** The first example opens with its column and chart already made: the visitor reads the result before pressing anything. */
	function startWorked(module: Live, made: Record<string, Sample>): void {
		const which = examples[0];
		const own = threadOf(which.id);
		which.prompts.forEach((prompt, index) => {
			if (prompt.kind !== 'formula' && prompt.kind !== 'chart') return;
			const item: Item = { key: (key += 1), text: prompt.text, action: null };
			own.items.push(item);
			own.used.push(index);
			const applied = module.applyPrompt(which, made[which.id], prompt, item.key);
			own.items[own.items.length - 1].action = applied.action;
			own.items[own.items.length - 1].view = applied.view;
		});
		own.view = app.ws.views(made[which.id].table).find((view) => view.type === 'grid')?.id;
		module.showEarly(which, made[which.id]);
	}

	async function run(index: number): Promise<void> {
		if (busy || live === null || samples === null) return;
		const which = example;
		const own = threadOf(which.id);
		const prompt = which.prompts[index];
		busy = true;
		void warm();
		for (let at = 2; at < prompt.text.length && !reduced(); at += 2) {
			typed = prompt.text.slice(0, at);
			await wait(14);
		}
		typed = prompt.text;
		await wait(260);

		const item: Item = { key: (key += 1), text: prompt.text, action: null };
		own.items.push(item);
		own.used.push(index);
		typed = '';
		working = true;
		await Promise.all([warm(), wait(700)]);

		const made = live.applyPrompt(which, samples[which.id], prompt, item.key);
		const grid = app.ws.views(samples[which.id].table).find((view) => view.type === 'grid')?.id;
		const shown = own.items[own.items.length - 1];
		shown.action = made.action;
		shown.view = made.view ?? grid;
		own.view = shown.view;
		working = false;
		busy = false;
		await tick();
		const box = body?.getBoundingClientRect();
		if (box !== undefined && !reduced()) wave(box.left + box.width / 2, box.top + box.height / 2);
	}

	function startOver(): void {
		const own = threadOf(example.id);
		live?.undoAll(own.items.flatMap((item) => (item.action === null ? [] : [item.action])));
		delete threads[example.id];
	}

	$effect(() => {
		void thread.items.length;
		void working;
		if (scroller !== undefined) scroller.scrollTo({ top: scroller.scrollHeight });
	});

	onMount(() => {
		void import('./live.ts').then((module) => {
			let made: Record<string, Sample> | null = null;
			const narrow = matchMedia('(max-width: 1023px)').matches;
			void app.openSample((ws, commit) => {
				made = module.seedExamples(ws, commit, examples, narrow);
			}, engineWanted);
			if (made !== null) startWorked(module, made);
			samples = made;
			live = module;
		});
		void import('./SampleView.svelte').then((module) => {
			View = module.default;
		});
		void import('#lib/views/Toast.svelte').then((module) => {
			Toast = module.default;
		});
	});

	const tab =
		'h-control shrink-0 rounded-box px-3.5 font-semibold transition-colors motion max-sm:h-9';
</script>

<section
	class="grid grid-cols-1 overflow-hidden rounded-panel bg-glass text-base shadow-raised backdrop-blur-glass lg:h-stage lg:grid-cols-[1fr_auto]"
	aria-label={t.demo}
	data-testid="demo"
	onpointerenter={(event) => {
		if (event.pointerType === 'mouse') void warm();
	}}
	onfocusin={() => void warm()}
>
	<div class="flex min-h-0 min-w-0 flex-col bg-glass-strong max-lg:h-stage-narrow">
		<div
			class="flex shrink-0 hide-scrollbar gap-1 overflow-x-auto p-2 pb-0 max-lg:hidden"
			role="group"
			aria-label={t.examples}
		>
			{#each examples as item (item.id)}
				<button
					type="button"
					class="{tab} {item.id === example.id
						? 'bg-fill text-on-fill'
						: 'bg-tint text-ink-2 hover:bg-tint-2 hover:text-ink'}"
					aria-pressed={item.id === example.id}
					onclick={() => {
						example = item;
						typed = '';
					}}>{item.label}</button
				>
			{/each}
		</div>
		<div class="flex min-h-12 shrink-0 items-center gap-2.5 py-1 pr-2 pl-3">
			<span class="truncate text-lg font-semibold tight">{example.table}</span>
			<span class="shrink-0 pt-0.5 text-sm text-ink-2" data-testid="row-count"
				>{t.rows(rowCount)}</span
			>
			{#if views.length > 0}
				<Segmented
					label={t.views}
					class="ml-auto"
					items={views.map((view) => ({
						id: view.id,
						label: view.name,
						active: view.id === viewId,
						onclick: () => {
							if (view.type === 'chart') void warm();
							show(view.id);
						}
					}))}
				/>
			{/if}
		</div>
		<div bind:this={body} class="relative min-h-0 flex-1 overflow-auto">
			{#if View !== null && sample !== undefined}
				<View tableId={sample.table} {viewId} />
			{/if}
		</div>
	</div>

	<aside
		class="flex min-h-0 min-w-0 flex-col border-hair max-lg:order-first max-lg:border-b lg:w-ask lg:border-l"
		aria-label={t.ask}
	>
		<div class="flex h-11 shrink-0 items-center px-4 font-semibold max-lg:hidden">{t.ask}</div>
		<div
			bind:this={scroller}
			class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 pb-3 max-lg:max-h-36 max-lg:pt-3"
			data-testid="thread"
		>
			{#each thread.items as item (item.key)}
				<div class="mt-2 flex justify-end first:mt-0">
					<p class="rounded-box bg-tint-2 px-3 py-2 font-medium break-words">{item.text}</p>
				</div>
				{#if item.action !== null && live !== null}
					<live.ChangeCard action={item.action} onshow={() => show(item.view)} />
				{/if}
			{/each}
			{#if working}
				<p class="text-ink-3" role="status">{t.working}</p>
			{/if}
		</div>

		<div class="flex shrink-0 flex-col gap-1 px-2 pb-2" role="group" aria-label={t.prompts}>
			{#each left as { prompt, index } (index)}
				<button
					type="button"
					class="rounded-box bg-raised px-2.5 py-2 text-left font-medium shadow-raised transition-shadow motion hover:ring-1 hover:ring-ink-3 disabled:opacity-50"
					disabled={busy || samples === null}
					onclick={() => void run(index)}>{prompt.text}</button
				>
			{:else}
				<button
					type="button"
					class="self-start px-1 py-1 text-sm text-ink-2 underline hover:text-ink disabled:text-ink-3"
					disabled={busy}
					onclick={startOver}>{t.startOver}</button
				>
			{/each}
		</div>

		<div class="m-2 mt-0 flex shrink-0 items-end gap-1 rounded-box bg-tint p-2 max-lg:hidden">
			<p class="min-h-control min-w-0 flex-1 px-1 py-1.5 {typed === '' ? 'text-ink-3' : ''}">
				{typed === '' ? t.askPlaceholder : typed}
			</p>
			<Button variant="primary" class="shrink-0" tabindex={-1} disabled={typed === ''}
				>{t.send}</Button
			>
		</div>
	</aside>
</section>

<section
	class="grid items-center gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
	aria-labelledby="landing-form"
	onpointerenter={(event) => {
		if (event.pointerType === 'mouse') void warm();
	}}
	onfocusin={() => void warm()}
>
	<div class="grid gap-3 px-4 lg:px-8">
		<h2 id="landing-form" class="text-h2 leading-tight font-semibold tighter text-balance">
			{t.formTitle}
		</h2>
		<p class="max-w-md text-lg text-ink-2">
			{t.formLead}
		</p>
	</div>
	<div
		class="h-stage-narrow min-w-0 overflow-hidden rounded-panel bg-glass-strong text-base shadow-raised backdrop-blur-glass"
		data-testid="form"
	>
		{#if View !== null && sample !== undefined && entryId !== undefined}
			<View tableId={sample.table} viewId={entryId} />
		{/if}
	</div>
</section>
{#if Toast !== null}
	<Toast />
{/if}
