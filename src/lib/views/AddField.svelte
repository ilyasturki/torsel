<script lang="ts">
	import { Popover } from 'bits-ui';
	import { tick } from 'svelte';

	import { app } from '#lib/client/app.svelte.ts';
	import { applyWithUndo } from '#lib/client/toast.svelte.ts';
	import { addField } from '#lib/core/actions.ts';
	import type { FieldType } from '#lib/core/model.ts';
	import Button from '#lib/ui/Button.svelte';
	import { fieldIcon } from '#lib/ui/field-icons.ts';
	import Icon from '#lib/ui/Icon.svelte';
	import Select from '#lib/ui/Select.svelte';
	import { input } from '#lib/ui/styles.ts';

	let {
		tableId,
		open = $bindable(false),
		class: extra = '',
		onmore
	}: {
		tableId: string;
		open?: boolean;
		class?: string;
		onmore: (name: string, type: FieldType) => void;
	} = $props();

	const AUTO = 'auto';

	const TYPES = [
		{ value: AUTO, label: 'From the first value' },
		...(
			[
				['text', 'Text'],
				['number', 'Number'],
				['date', 'Date'],
				['check', 'Checkbox'],
				['choice', 'Choice…'],
				['link', 'Link to a table…'],
				['formula', 'Formula…']
			] as const
		).map(([value, label]) => ({ value, label, icon: fieldIcon(value) }))
	];

	let name = $state('');
	let type = $state<FieldType | typeof AUTO>(AUTO);
	let field: HTMLInputElement | undefined = $state();
	let trigger: HTMLButtonElement | null = $state(null);

	function add(): void {
		const label = name.trim();
		if (label === '') {
			open = false;
			return;
		}

		if (type === 'choice' || type === 'link' || type === 'formula') {
			onmore(label, type);
			name = '';
			type = AUTO;
			open = false;
			return;
		}

		const { changes } = addField(app.ws, tableId, {
			name: label,
			type: type === AUTO ? 'text' : type,
			auto: type === AUTO
		});
		applyWithUndo(changes, `Field "${label}" added`);
		name = '';
		type = AUTO;
		field?.focus();
		void tick().then(() => {
			const nearest = { block: 'nearest', inline: 'nearest' } as const;
			trigger?.scrollIntoView(nearest);
			trigger?.closest('th')?.previousElementSibling?.scrollIntoView(nearest);
		});
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger bind:ref={trigger} class={extra} aria-label="Add a field">
		<Icon name="plus" />
	</Popover.Trigger>
	<Popover.Portal>
		<Popover.Content
			role="dialog"
			aria-label="Add a field"
			align="end"
			sideOffset={4}
			collisionPadding={8}
			sticky="always"
			class="z-30 flex w-72 max-w-full flex-col gap-2 rounded-panel bg-float p-2 shadow-float outline-none"
		>
			<input
				bind:this={field}
				class={input}
				bind:value={name}
				placeholder="Field name"
				aria-label="Field name"
				onkeydown={(event) => {
					if (event.key === 'Enter') {
						event.preventDefault();
						add();
					}
				}}
			/>
			<div class="flex gap-2">
				<Select class="flex-1" aria-label="Field type" options={TYPES} bind:value={type} />
				<Button variant="primary" disabled={name.trim() === ''} onclick={add}>Add</Button>
			</div>
		</Popover.Content>
	</Popover.Portal>
</Popover.Root>
