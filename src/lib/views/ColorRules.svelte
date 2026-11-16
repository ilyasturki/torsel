<script lang="ts">
	import { app } from '#lib/client/app.svelte.ts';
	import type { ColorRule } from '#lib/core/conditions.ts';
	import { OPS_OF, kindOf } from '#lib/core/conditions.ts';
	import { hasChoices } from '#lib/core/model.ts';
	import { rules as words } from '#lib/i18n/rules.ts';
	import Button from '#lib/ui/Button.svelte';
	import { DATA_COLORS, isDataColor, scaleStep, swatch } from '#lib/ui/colors.ts';
	import Icon from '#lib/ui/Icon.svelte';
	import IconButton from '#lib/ui/IconButton.svelte';
	import Select from '#lib/ui/Select.svelte';
	import { checkbox, focus } from '#lib/ui/styles.ts';

	import ConditionRow from './ConditionRow.svelte';

	let {
		tableId,
		rules,
		onchange
	}: { tableId: string; rules: ColorRule[]; onchange: (next: ColorRule[]) => void } = $props();

	const fields = $derived.by(() => {
		void app.version;
		return app.ws.fields(tableId);
	});
	const choiceFields = $derived(fields.filter((field) => hasChoices(field.type)));
	const numberFields = $derived(fields.filter((field) => kindOf(field) === 'number'));

	const matchAt = $derived(rules.findIndex((rule) => 'choices' in rule));

	function cycle(color: string): string {
		const at = isDataColor(color) ? DATA_COLORS.indexOf(color) : 0;
		return DATA_COLORS[(at + 1) % DATA_COLORS.length];
	}

	function recolor(at: number): void {
		const rule = rules[at];
		if ('choices' in rule) return;
		onchange(rules.with(at, { ...rule, color: cycle(rule.color) }));
	}

	function toggleMatch(): void {
		if (matchAt !== -1) onchange(rules.toSpliced(matchAt, 1));
		else if (choiceFields[0] !== undefined) onchange([...rules, { choices: choiceFields[0].id }]);
	}

	function addRule(): void {
		const field = fields[0];
		if (field === undefined) return;
		onchange([...rules, { when: { field: field.id, op: OPS_OF[kindOf(field)][0] }, color: 'red' }]);
	}

	function addScale(): void {
		const field = numberFields[0];
		if (field !== undefined) onchange([...rules, { scale: field.id, color: 'green' }]);
	}

	const fieldOptions = (list: typeof fields) =>
		list.map((field) => ({ value: field.id, label: field.name }));
</script>

{#snippet colorButton(at: number, color: string, scale: boolean)}
	<button
		type="button"
		class="flex size-control shrink-0 items-center {scale
			? ''
			: 'max-sm:mt-2'} justify-center rounded-box hover:bg-tint {focus}"
		aria-label={words.colorNames[isDataColor(color) ? color : 'gray']}
		onclick={() => recolor(at)}
	>
		{#if scale}
			<span class="flex h-mark overflow-hidden rounded-box">
				{#each [1, 3, 5] as step (step)}
					<span class="h-full w-1.5" style={scaleStep(color, step)}></span>
				{/each}
			</span>
		{:else}
			<span class="size-mark rounded-box" style={swatch(color)}></span>
		{/if}
	</button>
{/snippet}

<div class="flex flex-col gap-2">
	{#if choiceFields.length > 0}
		<label class="flex min-h-control items-center gap-2">
			<input type="checkbox" class={checkbox} checked={matchAt !== -1} onchange={toggleMatch} />
			<span class="flex-1">{words.matchChoices}</span>
			{#if matchAt !== -1 && choiceFields.length > 1}
				<Select
					class="w-40"
					aria-label={words.matchChoices}
					options={fieldOptions(choiceFields)}
					value={(rules[matchAt] as { choices: string }).choices}
					onchange={(field) => onchange(rules.with(matchAt, { choices: field }))}
				/>
			{/if}
		</label>
	{/if}
	{#each rules as rule, at (at)}
		{#if 'when' in rule}
			<div class="flex items-start gap-1">
				{@render colorButton(at, rule.color, false)}
				<div class="min-w-0 flex-1">
					<ConditionRow
						{tableId}
						condition={rule.when}
						removeLabel={words.removeRule}
						onchange={(when) => onchange(rules.with(at, { ...rule, when }))}
						onremove={() => onchange(rules.toSpliced(at, 1))}
					/>
				</div>
			</div>
		{:else if 'scale' in rule}
			<div class="flex items-center gap-1">
				{@render colorButton(at, rule.color, true)}
				<Select
					class="w-40 max-sm:flex-1"
					aria-label={words.scale}
					options={fieldOptions(numberFields)}
					value={rule.scale}
					onchange={(field) => onchange(rules.with(at, { ...rule, scale: field }))}
				/>
				<span class="flex-1 truncate px-2 text-ink-2 max-sm:hidden">{words.scale}</span>
				<IconButton
					icon="x"
					label={words.removeRule}
					onclick={() => onchange(rules.toSpliced(at, 1))}
				/>
			</div>
		{/if}
	{/each}
	<div class="flex flex-wrap gap-1">
		<Button variant="ghost" onclick={addRule}><Icon name="plus" />{words.addRule}</Button>
		{#if numberFields.length > 0}
			<Button variant="ghost" onclick={addScale}><Icon name="plus" />{words.scale}</Button>
		{/if}
	</div>
</div>
