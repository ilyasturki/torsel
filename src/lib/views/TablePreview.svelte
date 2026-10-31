<script lang="ts">
	import { app } from '#lib/client/app.svelte.ts';
	import type { GhostTable } from '#lib/client/assistant.svelte.ts';
	import { accept, previewTable, reject } from '#lib/client/assistant.svelte.ts';
	import type { FieldDef, Rec, Value } from '#lib/core/model.ts';
	import Button from '#lib/ui/Button.svelte';

	import CellValue from './CellValue.svelte';
	import ProposedHeader from './ProposedHeader.svelte';

	let { ghost }: { ghost: GhostTable } = $props();

	const preview = $derived.by(() => {
		void app.version;
		return previewTable(ghost.table.id);
	});

	function valueOf(row: Rec, field: FieldDef): Value | undefined {
		return field.type === 'formula'
			? (preview.computed.get(row.id)?.[field.id] ?? null)
			: row.data[field.id];
	}
</script>

<div class="flex h-full flex-col">
	<div
		class="flex shrink-0 flex-wrap items-center gap-2 bg-tint-2 p-2 pl-3"
		data-testid="proposed-table"
	>
		<span class="min-w-0 flex-1 font-medium">Proposed table: {ghost.table.name}</span>
		<Button variant="primary" onclick={() => accept(ghost.action.id)}>Accept</Button>
		<Button onclick={() => reject(ghost.action.id)}>Reject</Button>
	</div>

	<div class="min-h-0 flex-1 enter overflow-auto">
		<div class="pb-tabs-clear">
			<table
				class="w-full border-separate border-spacing-0"
				aria-label="Preview of {ghost.table.name}"
			>
				<thead>
					<tr>
						<th
							class="sticky top-0 left-0 z-30 w-11 min-w-11 border-b border-hair bg-raised max-sm:bg-canvas"
							aria-hidden="true"
						></th>
						{#each preview.fields as field (field.field.id)}
							<th
								scope="col"
								class="sticky top-0 z-20 h-row min-w-32 border-b border-edge bg-raised p-0 text-sm font-medium text-ink max-sm:bg-canvas"
								data-testid="proposed-field"
							>
								<ProposedHeader ghost={field} decides={field.action.id !== ghost.action.id} />
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each preview.rows as row, index (row.id)}
						<tr>
							<td
								class="sticky left-0 z-10 h-row border-b border-hair bg-raised pr-2 text-right text-xs text-ink-3 max-sm:bg-canvas"
								>{index + 1}</td
							>
							{#each preview.fields as { field } (field.id)}
								<td
									class="h-row max-w-xs truncate border-b border-hair bg-tint px-3 {field.type ===
										'number' || field.type === 'formula'
										? 'text-right'
										: ''}"
								>
									<CellValue {field} value={valueOf(row, field)} />
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
</div>
