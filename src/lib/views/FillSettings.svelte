<script lang="ts">
	import { app } from '#lib/client/app.svelte.ts';
	import { applyWithUndo } from '#lib/client/toast.svelte.ts';
	import { updateRecord } from '#lib/core/actions.ts';
	import { MAX_FILL_PROMPT, promptToDisplay, promptToStored } from '#lib/core/autofill.ts';
	import type { FieldDef, FillSpec, Value } from '#lib/core/model.ts';
	import { assistant as words } from '#lib/i18n/assistant.ts';
	import { fields as fieldWords } from '#lib/i18n/fields.ts';
	import Field from '#lib/ui/Field.svelte';
	import { checkbox, secondary } from '#lib/ui/styles.ts';
	import Textarea from '#lib/ui/Textarea.svelte';

	let { field }: { field: FieldDef } = $props();

	const others = $derived(
		app.ws.fields(field.table).filter((other) => other.id !== field.id && other.type !== 'formula')
	);

	let on = $state(false);
	let draft = $state('');
	let web = $state(false);
	let auto = $state(false);
	let box: HTMLTextAreaElement | undefined = $state();

	let seen: string | null = null;
	$effect(() => {
		// A field opened, or its fill changed elsewhere: the settings read it again.
		const key = `${field.id}:${JSON.stringify(field.fill)}`;
		if (key === seen) return;
		seen = key;
		on = field.fill !== null;
		draft =
			field.fill === null ? '' : promptToDisplay(field.fill.prompt, app.ws.fields(field.table));
		web = field.fill?.web ?? false;
		auto = field.fill?.auto ?? false;
	});

	function apply(): void {
		const prompt = promptToStored(draft.trim(), app.ws.fields(field.table));
		const spec: FillSpec | null =
			on && prompt !== ''
				? {
						prompt,
						web,
						auto,
						since: auto ? (field.fill?.auto ? field.fill.since : Date.now()) : 0
					}
				: null;
		if (JSON.stringify(spec) === JSON.stringify(field.fill)) return;
		applyWithUndo(
			updateRecord(app.ws, field.id, { fill: spec as unknown as Value }),
			fieldWords.changed(field.name)
		);
	}

	function insert(name: string): void {
		const at = box?.selectionStart ?? draft.length;
		draft = `${draft.slice(0, at)}{${name}}${draft.slice(box?.selectionEnd ?? at)}`;
		const caret = at + name.length + 2;
		requestAnimationFrame(() => {
			box?.focus();
			box?.setSelectionRange(caret, caret);
		});
	}
</script>

<div class="flex flex-col gap-2" data-testid="fill-settings">
	<label class="flex items-center gap-2">
		<input type="checkbox" class={checkbox} bind:checked={on} onchange={apply} />
		{words.fillWithAi}
	</label>
	{#if on}
		<Field label={words.fillPrompt}>
			<Textarea
				bind:ref={box}
				bind:value={draft}
				rows={2}
				maxlength={MAX_FILL_PROMPT}
				placeholder={words.fillHint}
				onblur={apply}
			/>
		</Field>
		{#if others.length > 0}
			<div class="flex flex-wrap gap-1">
				{#each others as other (other.id)}
					<button
						type="button"
						class="rounded-box px-1.5 text-sm max-sm:py-1.5 {secondary}"
						onmousedown={(event) => event.preventDefault()}
						onclick={() => insert(other.name)}>{other.name}</button
					>
				{/each}
			</div>
		{/if}
		<label class="flex items-center gap-2">
			<input type="checkbox" class={checkbox} bind:checked={web} onchange={apply} />
			{words.fillWeb}
		</label>
		<label class="flex items-center gap-2">
			<input type="checkbox" class={checkbox} bind:checked={auto} onchange={apply} />
			{words.fillNew}
		</label>
	{/if}
</div>
