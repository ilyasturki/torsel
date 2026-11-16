<script lang="ts">
	import { app } from '#lib/client/app.svelte.ts';
	import type { Condition } from '#lib/core/conditions.ts';
	import { OPS_OF, kindOf } from '#lib/core/conditions.ts';
	import { rules as words } from '#lib/i18n/rules.ts';
	import Button from '#lib/ui/Button.svelte';
	import Icon from '#lib/ui/Icon.svelte';

	import ConditionRow from './ConditionRow.svelte';

	let {
		tableId,
		filters,
		onchange
	}: { tableId: string; filters: Condition[]; onchange: (next: Condition[]) => void } = $props();

	function add(): void {
		const field = app.ws.fields(tableId)[0];
		if (field === undefined) return;
		onchange([...filters, { field: field.id, op: OPS_OF[kindOf(field)][0] }]);
	}
</script>

<div class="flex flex-col gap-2">
	{#each filters as condition, at (at)}
		<ConditionRow
			{tableId}
			{condition}
			onchange={(next) => onchange(filters.with(at, next))}
			onremove={() => onchange(filters.toSpliced(at, 1))}
		/>
	{/each}
	<Button variant="ghost" class="self-start" onclick={add}>
		<Icon name="plus" />{words.addCondition}
	</Button>
</div>
