<script lang="ts">
	import { untrack } from 'svelte';

	import { editText, readValue } from '#lib/client/format.ts';
	import type { FieldFormat, Value } from '#lib/core/model.ts';
	import CalendarPopover from '#lib/ui/CalendarPopover.svelte';
	import Drawer from '#lib/ui/Drawer.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import { wide } from '#lib/ui/media.svelte.ts';
	import { fieldFill, fieldFocusWithin, focus } from '#lib/ui/styles.ts';

	import DatePanel from './DatePanel.svelte';
	import { dayPicked } from './dates.ts';
	import { stampOf, stampText } from './stamp.ts';

	let {
		field,
		label,
		value = $bindable(),
		id
	}: { field: FieldFormat; label: string; value?: Value; id?: string } = $props();

	const shown = (current: Value | undefined): string =>
		typeof current === 'string' ? editText(field, current) : '';

	let text = $state(shown(value));
	let open = $state(false);
	let wrap = $state<HTMLElement>();

	const read = $derived(readValue(field, text));

	let mine: Value = untrack(() => value ?? null);

	$effect(() => {
		const current = value ?? null;
		untrack(() => {
			if (current !== mine) text = shown(current);
			mine = current;
		});
	});

	function put(next: Value): void {
		mine = next;
		value = next;
	}

	function choose(next: Value): void {
		put(next);
		text = shown(next);
		open = false;
	}

	function onkeydown(event: KeyboardEvent): void {
		const kind = stampOf(event);
		if (kind !== null) {
			const stamp = stampText(field, kind === 'time');
			if (stamp === null) return;
			event.preventDefault();
			put(readValue(field, stamp) ?? null);
			text = stamp;
		} else if (event.key === 'Escape' && open) {
			event.preventDefault();
			event.stopPropagation();
			open = false;
		} else if (event.key === 'ArrowDown' && !open) {
			event.preventDefault();
			open = true;
		} else if (event.key === 'Enter' || event.key === 'Tab') {
			open = false;
		}
	}
</script>

{#if wide.current}
	<span
		bind:this={wrap}
		class="flex h-control w-full min-w-0 items-center rounded-box text-ink transition-colors motion {fieldFill} {fieldFocusWithin}"
	>
		<Icon
			name={field.type === 'datetime' ? 'date-time' : 'date'}
			class="ml-2 size-4 shrink-0 text-ink-3"
		/>
		<input
			{id}
			class="h-full min-w-0 flex-1 bg-transparent px-2 outline-none placeholder:text-ink-3"
			aria-label={label}
			placeholder={label}
			autocomplete="off"
			aria-invalid={(text.trim() !== '' && read === undefined) || undefined}
			aria-expanded={open}
			aria-haspopup="dialog"
			value={text}
			oninput={(event) => {
				text = event.currentTarget.value;
				const next = readValue(field, text);
				if (next !== undefined) put(next);
			}}
			onclick={() => (open = true)}
			onblur={() => {
				open = false;
				text = shown(value);
			}}
			{onkeydown}
		/>
	</span>
	{#if open && wrap}
		<CalendarPopover
			anchor={wrap}
			value={typeof read === 'string' ? read : typeof value === 'string' ? value : null}
			onpick={(day) => choose(dayPicked(field, value, day))}
			onoutside={() => (open = false)}
		/>
	{/if}
{:else}
	<button
		{id}
		type="button"
		class="flex h-control w-full min-w-0 items-center gap-2 rounded-box px-2 text-left transition-colors motion {fieldFill} {focus}"
		aria-label={label}
		onclick={() => (open = true)}
	>
		<Icon
			name={field.type === 'datetime' ? 'date-time' : 'date'}
			class="size-4 shrink-0 text-ink-3"
		/>
		<span class="min-w-0 truncate {text === '' ? 'text-ink-3' : 'text-ink'}">{text || label}</span>
	</button>
	<Drawer bind:open title={label}>
		<DatePanel {field} {label} {value} onchoose={choose} />
	</Drawer>
{/if}
