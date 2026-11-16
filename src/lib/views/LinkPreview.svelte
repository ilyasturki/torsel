<script lang="ts">
	import type { LinkImport } from '#lib/client/link.svelte.ts';
	import type { BaseDef, FieldDef } from '#lib/core/model.ts';
	import { coerce } from '#lib/core/values.ts';
	import { fieldDef } from '#lib/core/workspace.ts';
	import { importing as words } from '#lib/i18n/importing.ts';
	import { sources as sourceWords } from '#lib/i18n/sources.ts';
	import { table as tableWords } from '#lib/i18n/table.ts';
	import Field from '#lib/ui/Field.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import { fieldIcon } from '#lib/ui/field-icons.ts';
	import Segmented from '#lib/ui/Segmented.svelte';
	import Select from '#lib/ui/Select.svelte';
	import { checkbox, input } from '#lib/ui/styles.ts';

	import CellValue from './CellValue.svelte';

	let {
		link,
		bases,
		base = $bindable()
	}: { link: LinkImport; bases: BaseDef[]; base: string } = $props();

	// A preview, not the table: enough rows to recognise the data.
	const SHOWN = 8;

	const preview = $derived(link.preview);

	const where = $derived.by(() => {
		if (preview === null) return '';
		try {
			const url = new URL(preview.url);
			return `${url.hostname.replace(/^www\./u, '')}${url.pathname === '/' ? '' : url.pathname}`;
		} catch {
			return preview.url;
		}
	});

	// Each column as the field it will be, so the preview shows values as the table will.
	const fields = $derived(
		link.columns.map((column): FieldDef =>
			fieldDef({
				id: column.path,
				kind: 'field',
				base: '',
				parent: '',
				data: {
					...Object.fromEntries(
						Object.entries(column).filter(([key]) => !['path', 'choices'].includes(key))
					),
					choices: (column.choices ?? []).map((name) => ({ name, color: null }))
				},
				clocks: {}
			})
		)
	);

	function toggle(path: string): void {
		if (link.dropped.has(path)) link.dropped.delete(path);
		else link.dropped.add(path);
	}
</script>

{#if preview !== null}
	<div class="flex min-w-0 flex-col gap-3">
		<div class="flex items-baseline justify-between gap-3 text-sm text-ink-3">
			<span class="min-w-0 truncate" title={preview.url}>{where}</span>
			<span class="shrink-0 whitespace-nowrap"
				>{words.found(preview.format.toUpperCase(), preview.count, preview.more)}</span
			>
		</div>

		<div class="max-h-72 overflow-auto rounded-box ring-1 ring-rule">
			<table class="w-full text-sm">
				<thead class="sticky top-0 bg-band">
					<tr>
						{#each link.columns as column (column.path)}
							{@const kept = !link.dropped.has(column.path)}
							<th class="border-b border-rule px-2 py-1.5 text-left font-medium whitespace-nowrap">
								<label class="flex items-center gap-1.5 {kept ? 'text-ink' : 'text-ink-3'}">
									<input
										type="checkbox"
										class={checkbox}
										checked={kept}
										onchange={() => toggle(column.path)}
									/>
									<Icon name={fieldIcon(column.type)} />
									<span>{column.name}</span>
								</label>
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each preview.items.slice(0, SHOWN) as item, index (index)}
						<tr>
							{#each fields as field (field.id)}
								<td
									class="max-w-48 truncate border-b border-rule px-2 py-1 whitespace-nowrap {link.dropped.has(
										field.id
									)
										? 'opacity-40'
										: ''}"><CellValue {field} value={coerce(field, item[field.id] ?? null)} /></td
								>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		{#if bases.length > 1}
			<Field label={words.base}>
				<Select
					options={bases.map((item) => ({ value: item.id, label: item.name }))}
					bind:value={base}
				/>
			</Field>
		{/if}

		<Field label={tableWords.tableName}>
			<input class={input} bind:value={link.name} />
		</Field>

		<div class="flex min-h-control flex-wrap items-center gap-x-4 gap-y-2">
			<label class="flex items-center gap-2">
				<input
					type="checkbox"
					class={checkbox}
					checked={link.refresh !== 'never'}
					onchange={(event) =>
						(link.refresh = event.currentTarget.checked
							? preview.suggested.every === 'manual'
								? 'hour'
								: preview.suggested.every
							: 'never')}
				/>
				{words.keepInSync}
			</label>
			{#if link.refresh !== 'never'}
				<Segmented
					label={words.keepInSync}
					items={(['hour', 'day'] as const).map((every) => ({
						id: every,
						label: sourceWords.schedule[every],
						active: link.refresh === every,
						onclick: () => (link.refresh = every)
					}))}
				/>
			{/if}
		</div>
	</div>
{/if}
