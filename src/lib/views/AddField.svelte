<script lang="ts">
	import { Popover } from 'bits-ui';
	import { tick } from 'svelte';

	import { app } from '#lib/client/app.svelte.ts';
	import { currencyFor } from '#lib/client/format.ts';
	import { applyWithUndo } from '#lib/client/toast.svelte.ts';
	import { addField } from '#lib/core/actions.ts';
	import { nameTaken } from '#lib/core/names.ts';
	import type { FieldType } from '#lib/core/model.ts';
	import { common } from '#lib/i18n/common.ts';
	import { fields as words } from '#lib/i18n/fields.ts';
	import Button from '#lib/ui/Button.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import Select from '#lib/ui/Select.svelte';
	import { input } from '#lib/ui/styles.ts';

	import { needsSettings, typeOptions } from './field-types.ts';

	let {
		tableId,
		open = $bindable(false),
		class: extra = '',
		anchor = null,
		at,
		onmore
	}: {
		tableId: string;
		open?: boolean;
		class?: string;
		/** Opens from this element instead of its own "+" button. */
		anchor?: HTMLElement | null;
		/** Where the new field goes among the table's fields; last when left out. */
		at?: number;
		onmore: (name: string, type: FieldType, at: number | undefined) => void;
	} = $props();

	const AUTO = 'auto';

	const TYPES = [
		{ value: AUTO, label: words.fromFirstValue },
		...typeOptions().map((option) =>
			needsSettings(option.value) ? { ...option, label: `${option.label}…` } : option
		)
	];

	let name = $state('');
	let type = $state<FieldType | typeof AUTO>(AUTO);
	const taken = $derived(nameTaken(app.ws.fields(tableId), name));
	let field: HTMLInputElement | undefined = $state();
	let trigger: HTMLButtonElement | null = $state(null);

	function add(): void {
		const label = name.trim();
		if (label === '') {
			open = false;
			return;
		}
		if (taken !== undefined) {
			return;
		}

		if (type !== AUTO && needsSettings(type)) {
			onmore(label, type, at);
			name = '';
			type = AUTO;
			open = false;
			return;
		}

		const { changes } = addField(
			app.ws,
			tableId,
			{
				name: label,
				type: type === AUTO ? 'text' : type,
				currency: type === 'currency' ? currencyFor(app.ws, tableId) : undefined,
				auto: type === AUTO
			},
			at
		);
		applyWithUndo(changes, words.added(label));
		name = '';
		type = AUTO;
		if (anchor !== null) {
			open = false;
			return;
		}
		field?.focus();
		void tick().then(() => {
			const nearest = { block: 'nearest', inline: 'nearest' } as const;
			trigger?.scrollIntoView(nearest);
			trigger?.closest('th')?.previousElementSibling?.scrollIntoView(nearest);
		});
	}
</script>

<Popover.Root bind:open>
	{#if anchor === null}
		<Popover.Trigger bind:ref={trigger} class={extra} aria-label={words.addField}>
			<Icon name="plus" />
		</Popover.Trigger>
	{/if}
	<Popover.Portal>
		<Popover.Content
			role="dialog"
			aria-label={words.addField}
			customAnchor={anchor}
			align={anchor === null ? 'end' : 'start'}
			sideOffset={4}
			collisionPadding={8}
			sticky="always"
			class="z-30 flex w-72 max-w-full flex-col gap-2 rounded-panel bg-float p-2 shadow-float outline-none"
		>
			<input
				bind:this={field}
				class={input}
				bind:value={name}
				placeholder={words.fieldName}
				aria-label={words.fieldName}
				onkeydown={(event) => {
					if (event.key === 'Enter') {
						event.preventDefault();
						add();
					}
				}}
			/>
			{#if taken}
				<p class="px-1 text-sm text-ink-2" role="alert">{words.nameTaken(taken.name)}</p>
			{/if}
			<div class="flex gap-2">
				<Select class="flex-1" aria-label={words.fieldType} options={TYPES} bind:value={type} />
				<Button variant="primary" disabled={name.trim() === '' || taken !== undefined} onclick={add}
					>{common.add}</Button
				>
			</div>
		</Popover.Content>
	</Popover.Portal>
</Popover.Root>
