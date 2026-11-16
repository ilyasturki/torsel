<script lang="ts">
	import { onMount } from 'svelte';

	import type { ThreadAction } from '#lib/core/thread.ts';
	import { assistant } from '#lib/i18n/assistant.ts';
	import { shell } from '#lib/i18n/shell.ts';
	import { site as t } from '#lib/i18n/site.ts';
	import Button from '#lib/ui/Button.svelte';
	import Logo from '#lib/ui/Logo.svelte';
	import { focus } from '#lib/ui/styles.ts';

	import type { Example } from './examples.ts';
	import type { Live, Samples } from './samples.svelte.ts';
	import type { Sample } from './seed.ts';

	type Item = { key: number; text: string; action: ThreadAction | null; view?: string };
	type Thread = { items: Item[]; used: number[]; view: string | undefined };

	let { samples }: { samples: Samples } = $props();

	const worked = (which: Example): number[] =>
		which.prompts.flatMap((prompt, index) =>
			prompt.kind === 'formula' || prompt.kind === 'chart' ? [index] : []
		);
	// svelte-ignore state_referenced_locally
	const first = samples.examples[0];
	// The server renders the first example's prompts as already asked, so nothing moves when its thread fills.
	const threads = $state<Record<string, Thread>>({
		[first.id]: { items: [], used: worked(first), view: undefined }
	});
	let typed = $state('');
	let busy = $state(false);
	let working = $state(false);
	let key = 0;

	let scroller = $state<HTMLElement>();

	const reduced = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;
	const wait = (ms: number): Promise<void> =>
		new Promise((done) => setTimeout(done, reduced() ? 0 : ms));

	function threadOf(id: string): Thread {
		threads[id] ??= { items: [], used: [], view: undefined };
		return threads[id];
	}

	const example = $derived(samples.example);
	const live = $derived(samples.live);
	const thread = $derived(threads[example.id] ?? { items: [], used: [], view: undefined });
	const viewId = $derived(thread.view ?? samples.views[0]?.id);
	const left = $derived(
		example.prompts
			.map((prompt, index) => ({ prompt, index }))
			.filter(({ index }) => !thread.used.includes(index))
	);

	function show(view: string | undefined): void {
		threadOf(example.id).view = view;
	}

	/** The first example opens with its column and chart already made: the visitor reads the result before pressing anything. */
	function startWorked(module: Live, made: Record<string, Sample>): void {
		const own = threadOf(first.id);
		for (const index of worked(first)) {
			const prompt = first.prompts[index];
			const item: Item = { key: (key += 1), text: prompt.text, action: null };
			own.items.push(item);
			const applied = module.applyPrompt(first, made[first.id], prompt, item.key);
			own.items[own.items.length - 1].action = applied.action;
			own.items[own.items.length - 1].view = applied.view;
		}
		own.view = module.app.ws.views(made[first.id].table).find((view) => view.type === 'grid')?.id;
		module.showEarly(first, made[first.id]);
	}

	async function run(index: number): Promise<void> {
		const tables = samples.tables;
		if (busy || live === null || tables === null) return;
		const which = example;
		const own = threadOf(which.id);
		const prompt = which.prompts[index];
		busy = true;
		void samples.warm();
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
		await Promise.all([samples.warm(), wait(700)]);

		const made = live.applyPrompt(which, tables[which.id], prompt, item.key);
		const grid = live.app.ws.views(tables[which.id].table).find((view) => view.type === 'grid')?.id;
		const shown = own.items[own.items.length - 1];
		shown.action = made.action;
		shown.view = made.view ?? grid;
		own.view = shown.view;
		working = false;
		busy = false;
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
		void samples.load(startWorked);
	});

	const tab = (active: boolean): string =>
		`relative flex h-10 shrink-0 items-center rounded-box px-3 font-medium whitespace-nowrap transition-colors motion ${focus} ${
			active
				? 'text-ink after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-ink'
				: 'text-ink-2 hover:text-ink'
		}`;
	const chip = (active: boolean): string =>
		`inline-flex h-control shrink-0 items-center rounded-box px-3 font-medium transition-colors motion ${focus} ${
			active ? 'bg-tint-2 text-ink' : 'text-ink-2 hover:bg-tint hover:text-ink'
		}`;
</script>

<section
	class="flex flex-col overflow-clip rounded-panel bg-canvas text-base shadow-raised ring-1 ring-frame lg:h-demo"
	aria-label={t.demo}
	data-testid="demo"
	onpointerenter={(event) => {
		if (event.pointerType === 'mouse') void samples.warm();
	}}
	onpointerdown={() => void samples.warm()}
	onfocusin={() => void samples.warm()}
>
	<div class="flex min-h-13 shrink-0 items-center gap-x-3 px-gutter py-2.5 max-sm:gap-x-2">
		<Logo class="size-4 shrink-0" />
		<span class="min-w-0 truncate font-semibold">{example.table}</span>
		<span class="shrink-0 text-ink-3" data-testid="row-count"
			>{shell.rowCount(samples.rowCount)}</span
		>
		<div class="ml-auto flex shrink-0 gap-1 max-lg:hidden" role="group" aria-label={t.examples}>
			{#each samples.examples as item (item.id)}
				<button
					type="button"
					class={chip(item.id === example.id)}
					aria-pressed={item.id === example.id}
					onclick={() => {
						samples.example = item;
						typed = '';
					}}>{item.label}</button
				>
			{/each}
		</div>
	</div>
	<div
		class="flex shrink-0 hide-scrollbar gap-1 overflow-x-auto border-b border-rule px-gutter max-sm:pr-2"
		role="group"
		aria-label={t.views}
	>
		{#each samples.views as view (view.id)}
			<button
				type="button"
				class={tab(view.id === viewId)}
				aria-pressed={view.id === viewId}
				onclick={() => {
					if (view.type === 'chart') void samples.warm();
					show(view.id);
				}}>{view.name}</button
			>
		{/each}
	</div>

	<div class="relative flex min-h-0 flex-1 gap-3 px-gutter pt-3 pb-5 max-lg:flex-col max-sm:p-0">
		<div
			class="min-h-0 min-w-0 flex-1 overflow-auto rounded-panel bg-raised ring-1 ring-frame max-lg:h-stage-narrow max-lg:flex-none max-sm:rounded-none max-sm:ring-0"
		>
			{#if samples.View !== null && samples.sample !== undefined}
				<samples.View tableId={samples.sample.table} {viewId} />
			{/if}
		</div>

		<aside
			class="flex min-h-0 min-w-0 flex-col rounded-panel bg-float shadow-float max-lg:order-first max-sm:rounded-none max-sm:shadow-none lg:w-ask"
			aria-label={assistant.ask}
		>
			<div class="flex h-11 shrink-0 items-center px-4 font-semibold max-lg:hidden">
				{assistant.ask}
			</div>
			<div
				bind:this={scroller}
				class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 pb-3 max-lg:h-36 max-lg:flex-none max-lg:pt-3"
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
					<p class="text-ink-3" role="status">{assistant.working}</p>
				{/if}
			</div>

			<div class="flex shrink-0 flex-col gap-1 px-2 pb-2" role="group" aria-label={t.prompts}>
				{#each left as { prompt, index } (index)}
					<button
						type="button"
						class="rounded-box bg-raised px-2.5 py-2 text-left font-medium shadow-raised transition-shadow motion hover:ring-1 hover:ring-ink-3 disabled:opacity-50"
						disabled={busy || samples.tables === null}
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
					{typed === '' ? assistant.prompt : typed}
				</p>
				<Button variant="primary" class="shrink-0" tabindex={-1} disabled={typed === ''}
					>{assistant.send}</Button
				>
			</div>
		</aside>
	</div>
</section>
