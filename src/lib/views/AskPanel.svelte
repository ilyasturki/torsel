<script lang="ts">
	import { tick } from 'svelte';

	import { page } from '$app/state';

	import { shrinkImage } from '#lib/client/attach.ts';
	import {
		assistant,
		deleteThread,
		edit,
		lastPrompt,
		newThread,
		openThread,
		redoTurn,
		renameThread,
		retry,
		send,
		showThreads,
		stop,
		turnActions,
		undoTurn,
		upload
	} from '#lib/client/assistant.svelte.ts';
	import { formatDate, formatNumber } from '#lib/client/format.ts';
	import { LOGIN, SETTINGS } from '#lib/client/nav.ts';
	import { clearSelection, selection } from '#lib/client/selection.svelte.ts';
	import { me } from '#lib/client/session.svelte.ts';
	import type { TableDef, ViewDef } from '#lib/core/model.ts';
	import type { Attachment, Item, ThreadContext } from '#lib/core/thread.ts';
	import {
		ATTACHABLE,
		MAX_CONTEXT_ROWS,
		MAX_FILES,
		MAX_PROMPT,
		toItems
	} from '#lib/core/thread.ts';
	import { todayIso } from '#lib/core/values.ts';
	import { assistant as words } from '#lib/i18n/assistant.ts';
	import { common } from '#lib/i18n/common.ts';
	import Button from '#lib/ui/Button.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import IconButton from '#lib/ui/IconButton.svelte';
	import { keys } from '#lib/ui/keys.ts';
	import Markdown from '#lib/ui/Markdown.svelte';
	import { fieldFill, fieldFocusWithin } from '#lib/ui/styles.ts';
	import Textarea from '#lib/ui/Textarea.svelte';
	import Tooltip from '#lib/ui/Tooltip.svelte';

	import ChangeCard from './ChangeCard.svelte';

	let {
		open = $bindable(false),
		table,
		view
	}: { open?: boolean; table: TableDef | null; view: ViewDef | null } = $props();

	type Pending = {
		key: string;
		name: string;
		size: number;
		received: number;
		file?: Attachment;
		error?: string;
	};

	let prompt = $state('');
	let editing = $state(false);
	let pending = $state<Pending[]>([]);
	let field: HTMLTextAreaElement | undefined = $state();
	let picker: HTMLInputElement | undefined = $state();
	let scroller: HTMLDivElement | undefined = $state();
	let pinned = $state(true);
	let renaming = $state<string | null>(null);
	let title = $state('');

	const selected = $derived(table !== null && selection.table === table.id ? selection.rows : []);

	const screen = $derived(
		page.url.pathname === SETTINGS ? 'settings' : table !== null ? 'table' : 'home'
	);

	const where = $derived.by(() => {
		if (screen === 'settings') return words.onSettings;
		if (table === null) return words.onHome;
		return words.onTable(table.name, view?.name ?? null, selected.length);
	});

	const items = $derived(toItems(assistant.rows, assistant.actions));

	const asked = $derived.by(() => {
		void assistant.rows.length;
		return lastPrompt();
	});

	const lastItem = $derived(items.at(-1));

	const uploading = $derived(
		pending.some((item) => item.file === undefined && item.error === undefined)
	);

	const loginHref = $derived(
		`${LOGIN}?to=${encodeURIComponent(page.url.pathname + page.url.search)}`
	);

	$effect(() => {
		// A hidden element refuses focus until its visibility transition has started.
		if (open) requestAnimationFrame(() => field?.focus());
	});

	$effect(() => {
		void items;
		if (pinned && scroller) {
			scroller.scrollTop = scroller.scrollHeight;
		}
	});

	// A screen the assistant opened has to be seen, and on a phone the panel covers it.
	let moved = assistant.moved;
	$effect(() => {
		if (assistant.moved !== moved) {
			moved = assistant.moved;
			closeOnPhone();
		}
	});

	function onscroll(): void {
		if (scroller) {
			pinned = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 48;
		}
	}

	function context(): ThreadContext {
		return {
			screen,
			base: table?.base ?? null,
			table: table?.id ?? null,
			view: view?.id ?? null,
			rows: selected.slice(0, MAX_CONTEXT_ROWS),
			fields: table !== null && selection.table === table.id ? selection.fields : [],
			today: todayIso(),
			shows: {
				locale: new Intl.NumberFormat().resolvedOptions().locale,
				today: formatDate(todayIso()),
				past: formatDate(`${new Date().getFullYear() - 1}-05-07`),
				number: formatNumber(1234.5)
			}
		};
	}

	function submit(): void {
		const text = prompt.trim();
		if (text === '' || assistant.busy || uploading) return;
		const files = pending.flatMap((item) => (item.file === undefined ? [] : [item.file]));
		const message = { prompt: text, context: context(), where, files };
		prompt = '';
		pending = [];
		pinned = true;
		if (editing) {
			editing = false;
			void edit(message);
		} else {
			void send(message);
		}
	}

	function startEdit(text: string): void {
		editing = true;
		prompt = text;
		// Within the task: a frame later, the caret would jump past what was typed meanwhile.
		void tick().then(() => {
			field?.focus();
			field?.setSelectionRange(prompt.length, prompt.length);
		});
	}

	function cancelEdit(): void {
		editing = false;
		prompt = '';
	}

	async function attach(files: Iterable<File>): Promise<void> {
		for (const raw of files) {
			if (pending.length >= MAX_FILES) break;
			const key = crypto.randomUUID();
			pending.push({ key, name: raw.name, size: raw.size, received: 0 });
			const item = (): Pending | undefined => pending.find((candidate) => candidate.key === key);
			try {
				const file = await shrinkImage(raw);
				const done = await upload(file, (received) => {
					const found = item();
					if (found) found.received = received;
				});
				const found = item();
				if (found) found.file = done;
			} catch (error) {
				const found = item();
				if (found) found.error = error instanceof Error ? error.message : words.uploadFailed;
			}
		}
	}

	function onkeydown(event: KeyboardEvent): void {
		if (!open) return;
		if (event.key === 'Escape') {
			if (editing) cancelEdit();
			else open = false;
		} else if (
			event.key === 'Enter' &&
			!event.shiftKey &&
			!event.isComposing &&
			event.target === field
		) {
			event.preventDefault();
			submit();
		}
	}

	function onpaste(event: ClipboardEvent): void {
		const files = [...(event.clipboardData?.files ?? [])];
		if (files.length > 0) {
			event.preventDefault();
			void attach(files);
		}
	}

	function hasFiles(event: DragEvent): boolean {
		return event.dataTransfer?.types.includes('Files') === true;
	}

	let dropping = $state(false);

	function closeOnPhone(): void {
		if (window.matchMedia('(max-width: 63.99rem)').matches) {
			open = false;
		}
	}

	function whereChanged(at: number): boolean {
		const item = items[at];
		if (item.kind !== 'user') return false;
		const before = items.slice(0, at).findLast((other: Item) => other.kind === 'user');
		return before?.kind !== 'user' || before.where !== item.where;
	}

	/** The turn bar goes under the last change of a turn that made several. */
	function turnEnd(at: number): number | null {
		const item = items[at];
		if (item.kind !== 'change') return null;
		const next = items.slice(at + 1).find((other) => other.kind === 'change');
		if (next?.kind === 'change' && next.action.turn === item.action.turn) return null;
		return turnActions(item.action.turn).length > 1 ? item.action.turn : null;
	}

	function when(at: number): string {
		const date = new Date(at);
		const today = new Date().toDateString() === date.toDateString();
		return today
			? date.toLocaleTimeString(undefined, { timeStyle: 'short' })
			: date.toLocaleDateString(undefined, { dateStyle: 'medium' });
	}

	async function saveTitle(id: string): Promise<void> {
		const text = title.trim();
		renaming = null;
		if (text !== '') await renameThread(id, text).catch(() => undefined);
	}

	function size(bytes: number): string {
		return bytes < 1024 * 1024
			? words.kilobytes(String(Math.max(1, Math.round(bytes / 1024))))
			: words.megabytes(
					(bytes / 1024 / 1024).toLocaleString(undefined, {
						minimumFractionDigits: 1,
						maximumFractionDigits: 1
					})
				);
	}
</script>

<svelte:window {onkeydown} />

<aside
	class="absolute top-3 right-gutter bottom-5 z-20 flex w-ask flex-col rounded-panel bg-float shadow-float transition-[transform,visibility] motion-slow max-lg:fixed max-lg:inset-0 max-lg:z-30 max-lg:w-auto max-lg:rounded-none max-lg:pt-safe max-lg:pb-safe {open
		? 'visible translate-x-0'
		: 'invisible translate-x-ask-out'} {dropping ? 'ring-2 ring-ink ring-inset' : ''}"
	aria-label={words.ask}
	ondragover={(event) => {
		if (me.account && hasFiles(event)) {
			event.preventDefault();
			event.stopPropagation();
			dropping = true;
		}
	}}
	ondragleave={(event) => {
		if (!event.currentTarget.contains(event.relatedTarget as Node | null)) dropping = false;
	}}
	ondrop={(event) => {
		dropping = false;
		if (me.account && hasFiles(event)) {
			event.preventDefault();
			event.stopPropagation();
			void attach([...(event.dataTransfer?.files ?? [])]);
		}
	}}
>
	<div class="flex h-11 shrink-0 items-center gap-1 pr-1.5 pl-4">
		<span class="min-w-0 flex-1 truncate font-semibold" data-testid="thread-title"
			>{assistant.title || words.ask}</span
		>
		{#if me.account}
			<Button
				variant="ghost"
				class={assistant.listing ? 'bg-tint-2 text-ink' : ''}
				aria-pressed={assistant.listing}
				onclick={() => void showThreads()}>{words.history}</Button
			>
			<Button variant="ghost" onclick={newThread}>{words.newThread}</Button>
		{/if}
		<Tooltip shortcut={keys('mod', 'k')}>
			{#snippet children(props)}
				<Button {...props} variant="ghost" onclick={() => (open = false)}>{common.close}</Button>
			{/snippet}
		</Tooltip>
	</div>

	{#if !me.account}
		<div class="flex flex-1 flex-col gap-2 px-4 pb-4">
			<a class="font-medium underline" href={loginHref}>{words.signIn}</a>
		</div>
	{:else if assistant.listing}
		<ul class="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2" aria-label={words.threads}>
			{#each assistant.threads as thread (thread.id)}
				<li
					class="group flex min-h-row items-center gap-1 rounded-box pr-1 transition-colors motion hover:bg-tint {thread.id ===
					assistant.id
						? 'bg-tint'
						: ''}"
				>
					{#if renaming === thread.id}
						<!-- svelte-ignore a11y_autofocus -->
						<input
							class="h-control min-w-0 flex-1 rounded-box bg-tint-2 px-2 outline-none"
							aria-label={words.threadName}
							bind:value={title}
							autofocus
							onkeydown={(event) => {
								if (event.key === 'Enter') void saveTitle(thread.id);
								if (event.key === 'Escape') {
									event.stopPropagation();
									renaming = null;
								}
							}}
							onblur={() => void saveTitle(thread.id)}
						/>
					{:else}
						<button
							type="button"
							class="flex min-w-0 flex-1 items-baseline gap-2 px-2 py-1.5 text-left"
							onclick={() => void openThread(thread.id)}
						>
							<span class="min-w-0 flex-1 truncate">{thread.title}</span>
							<span class="shrink-0 text-sm text-ink-3">{when(thread.updatedAt)}</span>
						</button>
						<IconButton
							icon="pencil"
							label={words.renameThread(thread.title)}
							class="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 max-lg:opacity-100"
							onclick={() => {
								title = thread.title;
								renaming = thread.id;
							}}
						/>
						<IconButton
							icon="x"
							label={words.deleteThread(thread.title)}
							class="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 max-lg:opacity-100"
							onclick={() => deleteThread(thread.id)}
						/>
					{/if}
				</li>
			{:else}
				<li class="px-2 text-ink-2">{words.noThreads}</li>
			{/each}
		</ul>
	{:else}
		<div
			bind:this={scroller}
			{onscroll}
			class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 pb-3"
			data-testid="thread"
		>
			{#each items as item, at (item.key)}
				{#if item.kind === 'user'}
					<div class="group mt-2 flex flex-col items-end gap-1 first:mt-0">
						{#if whereChanged(at)}<p class="self-start text-sm text-ink-3">{item.where}</p>{/if}
						<div class="flex max-w-full items-start gap-1">
							{#if !assistant.busy && asked?.seq === item.seq && item.seq !== 0}
								<IconButton
									icon="pencil"
									label={words.edit}
									class="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 max-lg:opacity-100"
									onclick={() => startEdit(item.text)}
								/>
							{/if}
							<div class="flex min-w-0 flex-col gap-1 rounded-box bg-tint-2 px-3 py-2">
								{#if item.files.length > 0}
									<div class="flex flex-wrap gap-1">
										{#each item.files as file (file.id)}
											<span class="flex items-center gap-1 text-sm text-ink-2"
												><Icon name="attach" class="size-3" />{file.name}</span
											>
										{/each}
									</div>
								{/if}
								<p class="font-medium break-words whitespace-pre-wrap">{item.text}</p>
							</div>
						</div>
					</div>
				{:else if item.kind === 'text'}
					<Markdown text={item.text} />
				{:else if item.kind === 'change'}
					<ChangeCard action={item.action} onopen={closeOnPhone} />
					{@const turn = turnEnd(at)}
					{#if turn !== null}
						{@const undone = turnActions(turn).every((action) => action.status === 'undone')}
						<div class="flex items-center justify-end">
							<button
								type="button"
								class="inline-flex h-control items-center px-1 text-sm text-ink-2 underline hover:text-ink"
								onclick={() => (undone ? redoTurn(turn) : undoTurn(turn))}
								>{undone ? words.redoAll : words.undoAll}</button
							>
						</div>
					{/if}
				{:else}
					<div class="flex items-center gap-3">
						<p
							role={item.event === 'error' ? 'alert' : undefined}
							class={item.event === 'error' ? 'font-medium' : 'text-ink-2'}
						>
							{item.message}
						</p>
						{#if item === lastItem && !assistant.busy && item.event !== 'declined'}
							<button
								type="button"
								class="inline-flex h-control items-center px-1 text-sm text-ink-2 underline hover:text-ink"
								onclick={() => void retry()}>{common.retry}</button
							>
						{/if}
					</div>
				{/if}
			{/each}
			{#if assistant.busy}
				<p class="text-ink-3" role="status">{words.working}</p>
			{/if}
		</div>

		<div class="flex shrink-0 items-center gap-2 px-4 pb-1 text-sm text-ink-3">
			{#if editing}
				<span class="min-w-0 flex-1 truncate">{words.editingLast}</span>
				<button type="button" class="shrink-0 underline" onclick={cancelEdit}
					>{common.cancel}</button
				>
			{:else}
				<span class="min-w-0 truncate" data-testid="context">{where}</span>
				{#if selected.length > 0}
					<button type="button" class="shrink-0 underline" onclick={clearSelection}
						>{common.clear}</button
					>
				{/if}
			{/if}
		</div>

		<form
			class="m-2 mt-0 flex shrink-0 flex-col gap-1 rounded-box p-2 {fieldFill} {fieldFocusWithin}"
			onsubmit={(event) => {
				event.preventDefault();
				submit();
			}}
		>
			{#if pending.length > 0}
				<ul class="flex flex-wrap gap-1" aria-label={words.attachedFiles}>
					{#each pending as item (item.key)}
						<li class="flex max-w-full items-center gap-1 rounded-box bg-tint px-2 text-sm">
							<Icon name="attach" class="size-3 text-ink-3" />
							<span class="min-w-0 truncate">{item.name}</span>
							<span class="shrink-0 text-ink-3"
								>{item.error ??
									(item.file === undefined
										? `${Math.round((item.received / item.size) * 100)}%`
										: size(item.size))}</span
							>
							<button
								type="button"
								class="flex size-5 shrink-0 items-center justify-center text-ink-3 hover:text-ink"
								aria-label={words.removeFile(item.name)}
								onclick={() => (pending = pending.filter((other) => other.key !== item.key))}
								><Icon name="x" class="size-3" /></button
							>
						</li>
					{/each}
				</ul>
			{/if}
			<div class="flex items-end gap-1">
				<label for="ask-input" class="sr-only">{words.prompt}</label>
				<Textarea
					id="ask-input"
					bare
					bind:ref={field}
					bind:value={prompt}
					rows={1}
					maxlength={MAX_PROMPT}
					enterkeyhint="send"
					class="flex-1 px-1 py-1.5"
					placeholder={words.prompt}
					{onpaste}
				/>
				<input
					bind:this={picker}
					type="file"
					multiple
					accept={ATTACHABLE}
					class="hidden"
					onchange={(event) => {
						// The list empties with the input, and the uploads read it one by one.
						void attach([...(event.currentTarget.files ?? [])]);
						event.currentTarget.value = '';
					}}
				/>
				<Button
					variant="ghost"
					class="w-control shrink-0 px-0"
					aria-label={words.attachFiles}
					title={pending.length >= MAX_FILES ? words.maxFiles(MAX_FILES) : undefined}
					disabled={pending.length >= MAX_FILES}
					onclick={() => picker?.click()}><Icon name="attach" /></Button
				>
				{#if assistant.busy}
					<Button class="shrink-0" onclick={stop}>{words.stop}</Button>
				{:else}
					<Button
						variant="primary"
						class="shrink-0"
						type="submit"
						title={uploading ? words.waitingUploads : undefined}
						disabled={prompt.trim() === '' || uploading}
						>{editing ? common.save : words.send}</Button
					>
				{/if}
			</div>
		</form>
	{/if}
</aside>
