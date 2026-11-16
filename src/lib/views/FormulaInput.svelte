<script lang="ts">
	import { tick } from 'svelte';

	import { app } from '#lib/client/app.svelte.ts';
	import type { NameAt, Named } from '#lib/core/formula.ts';
	import {
		callAt,
		completeFunction,
		completeName,
		functionsFor,
		nameAt,
		namesFor,
		scopeOf
	} from '#lib/core/formula.ts';
	import { AGGREGATE_NAMES, FUNCTIONS } from '#lib/core/functions.ts';
	import { fields as words } from '#lib/i18n/fields.ts';
	import { fieldIcon } from '#lib/ui/field-icons.ts';
	import type { IconName } from '#lib/ui/Icon.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import { fieldFill, fieldFocusWithin, menuItem } from '#lib/ui/styles.ts';
	import Textarea from '#lib/ui/Textarea.svelte';

	let {
		value = $bindable(''),
		ref = $bindable(),
		tableId,
		fieldId,
		label,
		placeholder,
		problem = '',
		hint = '',
		rows = 1,
		maxRows = 6,
		onkeydown,
		oninput,
		onblur
	}: {
		value?: string;
		ref?: HTMLTextAreaElement;
		tableId: string;
		/** The field the formula belongs to, which it can't name. */
		fieldId: string | null;
		label: string;
		placeholder: string;
		problem?: string;
		hint?: string;
		rows?: number;
		maxRows?: number;
		/** Keys the suggestions leave alone. */
		onkeydown?: (event: KeyboardEvent) => void;
		oninput?: () => void;
		onblur?: () => void;
	} = $props();

	type Option = { name: string; icon: IconName; call: boolean };

	const SHOWN = 6;
	const id = $props.id();

	let caret = $state(0);
	let active = $state(0);
	let dismissed = $state(false);

	const scope = $derived.by(() => {
		void app.version;
		return scopeOf(app.ws, tableId, fieldId);
	});
	const typing = $derived(nameAt(value, caret));
	const call = $derived(callAt(value, caret));

	function same(name: string): (named: Named) => boolean {
		const wanted = name.trim().toLowerCase();
		return (named) => named.name.trim().toLowerCase() === wanted;
	}

	function named(at: NameAt, pool: Named[], icon: (named: Named) => IconName): Option[] {
		return namesFor(
			at,
			pool.map((each) => each.name)
		).map((name) => ({ name, icon: icon(pool.find(same(name)) as Named), call: false }));
	}

	const typeIcon = (named: Named): IconName => fieldIcon(app.ws.field(named.id)?.type ?? 'text');

	const options = $derived.by((): Option[] => {
		if (typing === null || dismissed) return [];
		if (typing.owner !== undefined) {
			const owned = same(typing.owner);
			const reached = [...scope.fields.filter(owned), ...scope.tables.filter(owned)]
				.map((owner) => scope.through(owner.id))
				.find((fields) => fields !== undefined);
			return reached === undefined ? [] : named(typing, reached, typeIcon).slice(0, SHOWN);
		}
		const folding = call !== null && AGGREGATE_NAMES.has(call.name);
		return [
			...named(typing, scope.fields, typeIcon),
			...(folding ? named(typing, scope.tables, () => 'link') : []),
			...functionsFor(typing).map((name) => ({ name, icon: 'formula' as const, call: true }))
		].slice(0, SHOWN);
	});

	const signature = $derived.by(() => {
		const fn = call === null ? undefined : FUNCTIONS.find((each) => each.name === call.name);
		if (fn === undefined || call === null) return [];
		const current = Math.min(call.arg, fn.args.length - 1);
		const parts = fn.args.flatMap((arg, index) => {
			const word = words.args[arg.name];
			const text = `${arg.optional ? `[${word}]` : word}${arg.repeats ? ', …' : ''}`;
			return [
				...(index > 0 ? [{ text: ', ', current: false }] : []),
				{ text, current: index === current }
			];
		});
		return [{ text: `${fn.name}(`, current: false }, ...parts, { text: ')', current: false }];
	});

	$effect(() => {
		void options.length;
		active = 0;
	});

	function pick(option: Option): void {
		if (typing === null) return;
		const done = (option.call ? completeFunction : completeName)(value, caret, typing, option.name);
		value = done.text;
		caret = done.caret;
		void tick().then(() => ref?.setSelectionRange(done.caret, done.caret));
	}

	function follow(): void {
		caret = ref?.selectionStart ?? value.length;
	}

	function keydown(event: KeyboardEvent): void {
		if (event.isComposing) return;
		if (options.length > 0) {
			if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
				event.preventDefault();
				const step = event.key === 'ArrowDown' ? 1 : -1;
				active = (active + step + options.length) % options.length;
				return;
			}
			if (event.key === 'Enter' || event.key === 'Tab') {
				event.preventDefault();
				pick(options[active]);
				return;
			}
			if (event.key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
				dismissed = true;
				return;
			}
		}
		onkeydown?.(event);
	}

	export function focusAt(at: number): void {
		caret = at;
		ref?.focus();
		ref?.setSelectionRange(at, at);
	}
</script>

<div class="rounded-box px-2 py-1.5 font-mono {fieldFill} {fieldFocusWithin}">
	<Textarea
		bind:ref
		bind:value
		bare
		{rows}
		{maxRows}
		aria-label={label}
		aria-invalid={problem !== ''}
		aria-autocomplete="list"
		aria-controls={options.length > 0 ? `${id}-options` : undefined}
		aria-activedescendant={options.length > 0 ? `${id}-option-${active}` : undefined}
		{placeholder}
		spellcheck="false"
		autocomplete="off"
		autocapitalize="off"
		enterkeyhint="done"
		oninput={() => {
			follow();
			dismissed = false;
			oninput?.();
		}}
		onkeyup={follow}
		onpointerup={follow}
		onfocus={follow}
		onkeydown={keydown}
		{onblur}
	/>
</div>
{#if options.length > 0}
	<div
		id="{id}-options"
		role="listbox"
		aria-label={words.suggestions}
		tabindex="-1"
		class="flex flex-col"
		onmousedown={(event) => event.preventDefault()}
	>
		{#each options as option, index (`${option.call}${option.name}`)}
			<button
				type="button"
				id="{id}-option-{index}"
				role="option"
				aria-selected={index === active}
				tabindex="-1"
				class="{menuItem} {index === active ? 'bg-tint-2' : 'hover:bg-tint'}"
				onclick={() => pick(option)}
			>
				<Icon name={option.icon} class="size-4 shrink-0 text-ink-3" />
				<span class="min-w-0 truncate {option.call ? 'font-mono' : ''}">{option.name}</span>
			</button>
		{/each}
	</div>
{/if}
{#if problem !== ''}
	<p class="px-2 pb-1 text-sm text-ink" role="alert">{problem}</p>
{:else if signature.length > 0}
	<p class="truncate px-2 pb-1 font-mono text-sm text-ink-3" data-testid="formula-signature">
		{#each signature as part, index (index)}<span class={part.current ? 'text-ink' : ''}
				>{part.text}</span
			>{/each}
	</p>
{:else if hint !== ''}
	<p class="px-2 pb-1 text-sm text-ink-3">{hint}</p>
{/if}
