<script lang="ts">
	import { tick } from 'svelte';

	import { page } from '$app/state';

	import { shrinkImage } from '#lib/client/attach.ts';
	import {
		assistant,
		deleteSaved,
		deleteThread,
		edit,
		lastPrompt,
		loadSaved,
		loadSuggestions,
		newThread,
		offer,
		openThread,
		redoTurn,
		renameThread,
		retry,
		savePrompt,
		saved,
		send,
		showThreads,
		stop,
		turnActions,
		undoTurn,
		upload
	} from '#lib/client/assistant.svelte.ts';
	import { app } from '#lib/client/app.svelte.ts';
	import { formatDate, formatNumber } from '#lib/client/format.ts';
	import { SETTINGS } from '#lib/client/nav.ts';
	import { clearSelection, selection } from '#lib/client/selection.svelte.ts';
	import { me } from '#lib/client/session.svelte.ts';
	import type { TableDef, ViewDef } from '#lib/core/model.ts';
	import type {
		Attachment,
		Item,
		SavedPrompt,
		Suggestion,
		ThreadContext
	} from '#lib/core/thread.ts';
	import {
		ATTACHABLE,
		MAX_CONTEXT_ROWS,
		MAX_FILES,
		MAX_MENTIONS,
		MAX_PROMPT,
		MAX_SAVED_NAME,
		mentionAt,
		mentionsIn,
		toItems
	} from '#lib/core/thread.ts';
	import { todayIso } from '#lib/core/values.ts';
	import { assistant as words } from '#lib/i18n/assistant.ts';
	import { common } from '#lib/i18n/common.ts';
	import { viewName } from '#lib/i18n/names.ts';
	import { formatLocale } from '#lib/i18n/runtime.ts';
	import Button from '#lib/ui/Button.svelte';
	import { fieldIcon } from '#lib/ui/field-icons.ts';
	import Icon from '#lib/ui/Icon.svelte';
	import type { IconName } from '#lib/ui/Icon.svelte';
	import IconButton from '#lib/ui/IconButton.svelte';
	import { keys } from '#lib/ui/keys.ts';
	import Markdown from '#lib/ui/Markdown.svelte';
	import { fieldFill, fieldFocusWithin, focus, secondary } from '#lib/ui/styles.ts';
	import Textarea from '#lib/ui/Textarea.svelte';
	import { roomy } from '#lib/ui/media.svelte.ts';
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
		return words.onTable(
			table.name,
			view === undefined || view === null ? null : viewName(view),
			selected.length
		);
	});

	const items = $derived(toItems(assistant.rows, assistant.actions));

	const asked = $derived.by(() => {
		void assistant.rows.length;
		return lastPrompt();
	});

	const lastItem = $derived(items.at(-1));

	const offering = $derived(
		items.length === 0 &&
			!assistant.busy &&
			!editing &&
			screen === 'table' &&
			assistant.kind !== 'tool'
	);

	$effect(() => {
		if (open && offering && me.account && table !== null) {
			void loadSuggestions(table.id, view?.id ?? null, todayIso());
		}
	});

	// The sent message being saved under a name, by its item key.
	let saving = $state<string | null>(null);
	let savingName = $state('');
	let nameField: HTMLInputElement | undefined = $state();

	// `/` at the start of the box lists the saved prompts whose name or text holds what follows.
	const slash = $derived(
		prompt.startsWith('/') && !prompt.includes('\n') ? prompt.slice(1).trim().toLowerCase() : null
	);
	const matches = $derived(
		slash === null || editing
			? []
			: (saved.list ?? []).filter(
					(item) =>
						item.name.toLowerCase().includes(slash) || item.text.toLowerCase().includes(slash)
				)
	);
	// Where the caret is, for the `@` being typed before it.
	let caret = $state(0);
	let dismissed = $state<number | null>(null);
	const mention = $derived.by(() => {
		if (editing) return null;
		const at = mentionAt(prompt, caret);
		return at === null || at.start === dismissed ? null : at;
	});
	type Mentionable = { id: string; name: string; icon: IconName; sub: string };
	const mentionable = $derived.by((): Mentionable[] => {
		if (mention === null) return [];
		void app.version;
		const query = mention.query.toLowerCase();
		const tables = app.ws.bases().flatMap((base) =>
			app.ws.tables(base.id).map((candidate) => ({
				id: candidate.id,
				name: candidate.name,
				icon: 'view-grid' as IconName,
				sub: base.name
			}))
		);
		const fields =
			table === null
				? []
				: app.ws.fields(table.id).map((candidate) => ({
						id: candidate.id,
						name: candidate.name,
						icon: fieldIcon(candidate.type),
						sub: table.name
					}));
		const options = [...tables, ...fields];
		// A name typed out in full is done: Enter sends the message.
		if (options.some((option) => option.name.toLowerCase() === query)) return [];
		return options.filter((option) => option.name.toLowerCase().includes(query)).slice(0, 8);
	});
	let aimed = $state(0);
	$effect(() => {
		void mention?.query;
		aimed = 0;
	});

	function readCaret(): void {
		caret = field?.selectionStart ?? prompt.length;
	}

	function pickMention(option: Mentionable): void {
		if (mention === null) return;
		const before = prompt.slice(0, mention.start);
		const after = prompt.slice(caret);
		const tag = `@${option.name} `;
		prompt = `${before}${tag}${after}`;
		const at = before.length + tag.length;
		caret = at;
		void tick().then(() => {
			field?.focus();
			field?.setSelectionRange(at, at);
		});
	}

	const next = $derived(
		!assistant.busy && !editing && prompt === '' && items.length > 0 ? assistant.followUp : ''
	);

	let picked = $state(0);
	$effect(() => {
		void slash;
		picked = 0;
	});

	$effect(() => {
		if (open && me.account && assistant.kind !== 'tool') void loadSaved();
	});

	function pick(item: SavedPrompt): void {
		prompt = item.text;
		void tick().then(() => {
			field?.focus();
			field?.setSelectionRange(prompt.length, prompt.length);
		});
	}

	function startSaving(key: string, text: string): void {
		const start = text.replace(/\s+/gu, ' ').trim().split(' ').slice(0, 5).join(' ');
		savingName = start.slice(0, MAX_SAVED_NAME);
		saving = key;
		void tick().then(() => nameField?.select());
	}

	function finishSaving(text: string): void {
		const name = savingName.trim();
		saving = null;
		if (name !== '') void savePrompt(name, text);
	}

	const uploading = $derived(
		pending.some((item) => item.file === undefined && item.error === undefined)
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
				locale: formatLocale(),
				today: formatDate(todayIso()),
				past: formatDate(`${new Date().getFullYear() - 1}-05-07`),
				number: formatNumber(12345.5)
			}
		};
	}

	function submit(): void {
		const text = prompt.trim();
		if (text === '' || assistant.busy || uploading) return;
		const files = pending.flatMap((item) => (item.file === undefined ? [] : [item.file]));
		const tables = app.ws.bases().flatMap((base) => app.ws.tables(base.id));
		const named = mentionsIn(
			text,
			tables.map((candidate) => candidate.name)
		).flatMap((name) => tables.filter((candidate) => candidate.name === name).map(({ id }) => id));
		const mentions = named.slice(0, MAX_MENTIONS);
		const message = {
			prompt: text,
			context: { ...context(), ...(mentions.length > 0 ? { mentions } : {}) },
			where,
			files
		};
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

	function take(suggestion: Suggestion): void {
		if (suggestion.complete) {
			prompt = suggestion.text;
			submit();
			return;
		}
		prompt = `${suggestion.text} `;
		void tick().then(() => {
			field?.focus();
			field?.setSelectionRange(prompt.length, prompt.length);
		});
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
		if (mentionable.length > 0 && event.target === field) {
			if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
				event.preventDefault();
				const step = event.key === 'ArrowDown' ? 1 : -1;
				aimed = (aimed + step + mentionable.length) % mentionable.length;
				return;
			}
			if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
				event.preventDefault();
				pickMention(mentionable[aimed]);
				return;
			}
			if (event.key === 'Escape') {
				dismissed = mention?.start ?? null;
				return;
			}
		}
		if (matches.length > 0 && event.target === field) {
			if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
				event.preventDefault();
				const step = event.key === 'ArrowDown' ? 1 : -1;
				picked = (picked + step + matches.length) % matches.length;
				return;
			}
			if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
				event.preventDefault();
				pick(matches[picked]);
				return;
			}
			if (event.key === 'Escape') {
				prompt = '';
				return;
			}
		}
		if (event.key === 'Tab' && event.target === field && next !== '' && roomy.current) {
			event.preventDefault();
			take({ text: next, complete: false });
			return;
		}
		if (event.key === 'Escape') {
			if (saving !== null) saving = null;
			else if (editing) cancelEdit();
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
			? date.toLocaleTimeString(formatLocale(), { timeStyle: 'short' })
			: date.toLocaleDateString(formatLocale(), { dateStyle: 'medium' });
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
					(bytes / 1024 / 1024).toLocaleString(formatLocale(), {
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
		if (hasFiles(event)) {
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
		if (hasFiles(event)) {
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
		<Button
			variant="ghost"
			class={assistant.listing ? 'bg-tint-2 text-ink' : ''}
			aria-pressed={assistant.listing}
			onclick={() => void showThreads()}>{words.history}</Button
		>
		<IconButton icon="plus" label={words.newThread} onclick={newThread} />
		<Tooltip text={common.close} shortcut={keys('mod', 'k')}>
			{#snippet children(props)}
				<IconButton
					{...props}
					icon="x"
					label={common.close}
					tooltip={false}
					onclick={() => (open = false)}
				/>
			{/snippet}
		</Tooltip>
	</div>

	{#if assistant.listing}
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
							{#if item.seq !== 0 && assistant.kind !== 'tool'}
								<IconButton
									icon="bookmark"
									label={words.savePrompt}
									class="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 max-lg:opacity-100"
									onclick={() => startSaving(item.key, item.text)}
								/>
							{/if}
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
						{#if saving === item.key}
							<form
								class="flex w-full items-center gap-1"
								onsubmit={(event) => {
									event.preventDefault();
									finishSaving(item.text);
								}}
							>
								<input
									class="h-control min-w-0 flex-1 rounded-box px-2 outline-none {fieldFill} {fieldFocusWithin}"
									aria-label={words.savedName}
									maxlength={MAX_SAVED_NAME}
									bind:value={savingName}
									bind:this={nameField}
								/>
								<Button variant="ghost" onclick={() => (saving = null)}>{common.cancel}</Button>
								<Button variant="primary" type="submit" disabled={savingName.trim() === ''}
									>{common.save}</Button
								>
							</form>
						{/if}
					</div>
				{:else if item.kind === 'text'}
					<Markdown text={item.text} />
				{:else if item.kind === 'sources'}
					<p class="flex flex-wrap items-center gap-x-3 text-sm text-ink-3" data-testid="sources">
						<Icon name="search" class="size-3 shrink-0" /><span class="sr-only"
							>{words.sources}</span
						>
						{#each item.sources as source (source.url)}
							<a
								class="underline hover:text-ink"
								href={source.url}
								target="_blank"
								rel="noopener noreferrer">{source.title}</a
							>
						{/each}
					</p>
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
			{#if offering && offer.list.length > 0 && prompt === ''}
				<ul class="mt-auto flex flex-col gap-1" aria-label={words.suggestions}>
					{#each offer.list as suggestion (suggestion.text)}
						<li>
							<button
								type="button"
								class="flex min-h-control w-full items-center gap-2 rounded-box px-2.5 py-1 text-left {secondary} {focus} transition-colors motion"
								onclick={() => take(suggestion)}
								><Icon
									name={suggestion.complete ? 'send' : 'pencil'}
									class="size-4 shrink-0 text-ink-3"
								/><span class="min-w-0 flex-1">{suggestion.text}</span></button
							>
						</li>
					{/each}
				</ul>
			{/if}
			{#if assistant.busy}
				<p class="text-ink-3" role="status" data-testid="step">
					{(assistant.step === null ? undefined : words.steps[assistant.step]) ?? words.working}
				</p>
			{/if}
		</div>

		{#if assistant.kind !== 'tool'}
			{#if !roomy.current && next !== ''}
				<div class="flex shrink-0 px-4 pb-2">
					<button
						type="button"
						class="min-h-control max-w-full truncate rounded-box px-2.5 text-left {secondary} {focus} transition-colors motion"
						data-testid="follow-up"
						onclick={() => take({ text: next, complete: true })}>{next}</button
					>
				</div>
			{/if}
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
				class="relative m-2 mt-0 flex shrink-0 flex-col gap-1 rounded-box p-2 {fieldFill} {fieldFocusWithin}"
				onsubmit={(event) => {
					event.preventDefault();
					submit();
				}}
			>
				{#if mentionable.length > 0}
					<ul
						class="absolute inset-x-0 bottom-full z-10 mb-1.5 flex max-h-72 flex-col overflow-y-auto rounded-panel bg-float p-1 shadow-float"
						role="listbox"
						aria-label={words.mentionable}
					>
						{#each mentionable as option, index (option.id)}
							<li
								class="flex min-h-control cursor-default items-center gap-2 rounded-box px-2 {index ===
								aimed
									? 'bg-tint-2'
									: ''}"
								role="option"
								aria-selected={index === aimed}
								onmousedown={(event) => event.preventDefault()}
								onclick={() => pickMention(option)}
								onkeydown={() => undefined}
								onpointerenter={() => (aimed = index)}
							>
								<Icon name={option.icon} class="size-4 shrink-0 text-ink-3" />
								<span class="shrink-0 font-medium">{option.name}</span>
								<span class="min-w-0 flex-1 truncate text-sm text-ink-3">{option.sub}</span>
							</li>
						{/each}
					</ul>
				{:else if matches.length > 0}
					<ul
						class="absolute inset-x-0 bottom-full z-10 mb-1.5 flex max-h-72 flex-col overflow-y-auto rounded-panel bg-float p-1 shadow-float"
						role="listbox"
						aria-label={words.saved}
					>
						{#each matches as item, index (item.id)}
							<li
								class="group flex min-h-control cursor-default items-center gap-2 rounded-box pl-2 {index ===
								picked
									? 'bg-tint-2'
									: ''}"
								role="option"
								aria-selected={index === picked}
								onmousedown={(event) => event.preventDefault()}
								onclick={() => pick(item)}
								onkeydown={() => undefined}
								onpointerenter={() => (picked = index)}
							>
								<Icon name="bookmark" class="size-4 shrink-0 text-ink-3" />
								<span class="shrink-0 font-medium">{item.name}</span>
								<span class="min-w-0 flex-1 truncate text-sm text-ink-3">{item.text}</span>
								<IconButton
									icon="x"
									label={words.deleteSaved(item.name)}
									class="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 max-lg:opacity-100"
									onclick={(event) => {
										event.stopPropagation();
										void deleteSaved(item);
									}}
								/>
							</li>
						{/each}
					</ul>
				{/if}
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
						placeholder={roomy.current && next !== '' ? next : words.prompt}
						{onpaste}
						oninput={readCaret}
						onkeyup={readCaret}
						onclick={readCaret}
					/>
					{#if roomy.current && next !== ''}
						<kbd
							class="mb-2 shrink-0 rounded-box px-1 font-sans text-xs text-ink-3 ring-1 ring-edge ring-inset"
							>{keys('tab')}</kbd
						>
					{/if}
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
	{/if}
</aside>
