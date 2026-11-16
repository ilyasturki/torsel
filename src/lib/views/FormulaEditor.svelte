<script lang="ts">
	import { Popover } from 'bits-ui';
	import { untrack } from 'svelte';

	import { app } from '#lib/client/app.svelte.ts';
	import { readFormula } from '#lib/client/formula.ts';
	import { applyWithUndo } from '#lib/client/toast.svelte.ts';
	import { updateRecord } from '#lib/core/actions.ts';
	import { namesIn, toDisplay } from '#lib/core/formula.ts';
	import type { FieldDef } from '#lib/core/model.ts';
	import { fields as words } from '#lib/i18n/fields.ts';
	import { popup } from '#lib/ui/styles.ts';

	import FormulaInput from './FormulaInput.svelte';

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

	const initial = untrack(() => toDisplay(field.expr ?? '', namesIn(app.ws, field.base)));
	let text = $state(untrack(() => initial + typed));
	let problem = $state('');
	let input = $state<FormulaInput>();

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
		const label = words.formulaChanged(field.name);
		applyWithUndo(updateRecord(app.ws, field.id, { expr: read.expr }), label);
		onclose();
		return true;
	}

	function onkeydown(event: KeyboardEvent): void {
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
				input?.focusAt(text.length);
			}}
			onCloseAutoFocus={(event) => event.preventDefault()}
			onEscapeKeydown={(event) => event.preventDefault()}
			onInteractOutside={(event) => {
				if (!save()) event.preventDefault();
			}}
			class="{popup} flex w-(--bits-popover-anchor-width) max-w-(--bits-popover-content-available-width) min-w-80 flex-col gap-1"
		>
			<FormulaInput
				bind:this={input}
				bind:value={text}
				tableId={field.table}
				fieldId={field.id}
				label={words.formulaOf(field.name)}
				placeholder={words.formulaShort}
				{problem}
				hint={words.wholeColumn}
				{onkeydown}
				oninput={() => (problem = '')}
			/>
		</Popover.Content>
	</Popover.Portal>
</Popover.Root>
