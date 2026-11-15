<script lang="ts">
	import { Popover } from 'bits-ui';
	import { tick, untrack } from 'svelte';

	import { app } from '#lib/client/app.svelte.ts';
	import { readFormula } from '#lib/client/formula.ts';
	import { applyWithUndo } from '#lib/client/toast.svelte.ts';
	import { updateRecord } from '#lib/core/actions.ts';
	import { completeName, nameAt, namesFor, toDisplay } from '#lib/core/formula.ts';
	import type { FieldDef } from '#lib/core/model.ts';
	import { fieldFill, fieldFocusWithin, menuItem, popup } from '#lib/ui/styles.ts';
	import Textarea from '#lib/ui/Textarea.svelte';

	let {
		field,
		anchor,
		typed = '',
		onclose
	}: {
		field: FieldDef;
		/** The cell or header it opens over. */
		anchor: HTMLElement;
		typed?: string;
		onclose: () => void;
	} = $props();

	const SHOWN = 6;

	const initial = untrack(() => toDisplay(field.expr ?? '', app.ws.fields(field.table)));
	let text = $state(untrack(() => initial + typed));
	let caret = $state(untrack(() => text.length));
	let problem = $state('');
	let active = $state(0);
	let dismissed = $state(false);
	let ref = $state<HTMLTextAreaElement>();

	const names = $derived.by(() => {
		void app.version;
		return app.ws
			.fields(field.table)
			.filter((other) => other.id !== field.id)
			.map((other) => other.name);
	});
	const typing = $derived(nameAt(text, caret));
	const offered = $derived(
		typing === null || dismissed ? [] : namesFor(typing, names).slice(0, SHOWN)
	);

	$effect(() => {
		void offered.length;
		active = 0;
	});

	function save(): boolean {
		if (text.trim() === initial.trim()) {
			onclose();
			return true;
		}
		const read = readFormula(field.table, field.id, text);
		if ('problem' in read) {
			problem = read.problem;
			return false;
		}
		const label = `${field.name} formula changed`;
		applyWithUndo(updateRecord(app.ws, field.id, { expr: read.expr }), label);
		onclose();
		return true;
	}

	function pick(name: string): void {
		if (typing === null) return;
		const done = completeName(text, caret, typing, name);
		text = done.text;
		caret = done.caret;
		void tick().then(() => ref?.setSelectionRange(done.caret, done.caret));
	}

	function follow(): void {
		caret = ref?.selectionStart ?? text.length;
	}

	function onkeydown(event: KeyboardEvent): void {
		if (event.isComposing) return;
		if (offered.length > 0) {
			if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
				event.preventDefault();
				const step = event.key === 'ArrowDown' ? 1 : -1;
				active = (active + step + offered.length) % offered.length;
				return;
			}
			if (event.key === 'Enter' || event.key === 'Tab') {
				event.preventDefault();
				pick(offered[active]);
				return;
			}
			if (event.key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
				dismissed = true;
				return;
			}
		}
		if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
			event.preventDefault();
			save();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			onclose();
		}
	}
</script>

<Popover.Root open={true}>
	<Popover.Portal>
		<Popover.Content
			customAnchor={anchor}
			side="bottom"
			align="start"
			sideOffset={-anchor.offsetHeight}
			collisionPadding={8}
			trapFocus={false}
			onOpenAutoFocus={(event) => {
				event.preventDefault();
				ref?.focus();
				ref?.setSelectionRange(caret, caret);
			}}
			onCloseAutoFocus={(event) => event.preventDefault()}
			onEscapeKeydown={(event) => event.preventDefault()}
			onInteractOutside={(event) => {
				if (!save()) event.preventDefault();
			}}
			class="{popup} flex w-(--bits-popover-anchor-width) max-w-(--bits-popover-content-available-width) min-w-80 flex-col gap-1"
		>
			<div class="rounded-box px-2 py-1.5 font-mono {fieldFill} {fieldFocusWithin}">
				<Textarea
					bind:ref
					bind:value={text}
					bare
					rows={1}
					maxRows={6}
					aria-label="Formula of {field.name}"
					aria-invalid={problem !== ''}
					aria-autocomplete="list"
					aria-controls={offered.length > 0 ? 'formula-names' : undefined}
					aria-activedescendant={offered.length > 0 ? `formula-name-${active}` : undefined}
					placeholder={'"Weight" * "Reps"'}
					spellcheck="false"
					autocomplete="off"
					enterkeyhint="done"
					oninput={() => {
						follow();
						dismissed = false;
						problem = '';
					}}
					onkeyup={follow}
					onpointerup={follow}
					{onkeydown}
				/>
			</div>
			{#if offered.length > 0}
				<div
					id="formula-names"
					role="listbox"
					aria-label="Fields"
					tabindex="-1"
					class="flex flex-col"
					onmousedown={(event) => event.preventDefault()}
				>
					{#each offered as name, index (name)}
						<button
							type="button"
							id="formula-name-{index}"
							role="option"
							aria-selected={index === active}
							tabindex="-1"
							class="{menuItem} {index === active ? 'bg-tint-2' : 'hover:bg-tint'}"
							onclick={() => pick(name)}
						>
							<span class="min-w-0 truncate">{name}</span>
						</button>
					{/each}
				</div>
			{/if}
			<p
				class="px-2 pb-1 text-sm {problem === '' ? 'text-ink-3' : 'text-ink'}"
				role={problem === '' ? undefined : 'alert'}
			>
				{problem === '' ? 'Applies to the whole column' : problem}
			</p>
		</Popover.Content>
	</Popover.Portal>
</Popover.Root>
