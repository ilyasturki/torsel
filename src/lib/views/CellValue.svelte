<script lang="ts">
	import { app } from '#lib/client/app.svelte.ts';
	import { formatValue } from '#lib/client/format.ts';
	import type { FieldDef, Value } from '#lib/core/model.ts';
	import { imagesOf } from '#lib/core/images.ts';
	import { isContact } from '#lib/core/model.ts';
	import { hrefOf, ratingScale } from '#lib/core/values.ts';
	import { fields as words } from '#lib/i18n/fields.ts';
	import { images as imageWords } from '#lib/i18n/images.ts';
	import Chip from '#lib/ui/Chip.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import Rating from '#lib/ui/Rating.svelte';

	import ImageThumb from './ImageThumb.svelte';

	let { field, value }: { field: FieldDef; value: Value | undefined } = $props();

	// Past three, a cell says how many more rather than shrink them.
	const SHOWN = 3;

	const colorOf = (name: string): string | null =>
		field.choices.find((choice) => choice.name === name)?.color ?? null;

	const title = $derived.by(() => {
		void app.version;
		return field.type === 'link' && typeof value === 'string' ? app.ws.rowTitle(value) : '';
	});
</script>

{#if value === null || value === undefined || value === ''}
	<span></span>
{:else if field.type === 'choice'}
	<Chip name={String(value)} color={colorOf(String(value))} />
{:else if field.type === 'choices' && Array.isArray(value)}
	<span class="flex min-w-0 items-center gap-1 overflow-hidden">
		{#each value as name, at (at)}
			<span class="shrink-0"><Chip name={String(name)} color={colorOf(String(name))} /></span>
		{/each}
	</span>
{:else if field.type === 'image'}
	{@const images = imagesOf(value)}
	<span class="flex min-w-0 items-center gap-1 overflow-hidden">
		{#each images.slice(0, SHOWN) as image (image.id)}
			<ImageThumb base={field.base} {image} />
		{/each}
		{#if images.length > SHOWN}
			<span class="shrink-0 text-xs text-ink-3 tabular-nums"
				>{imageWords.more(images.length - SHOWN)}</span
			>
		{/if}
	</span>
{:else if field.type === 'check'}
	{#if value === true || value === 1}
		<Icon name="check" label={words.checked} />
	{/if}
{:else if field.type === 'link'}
	<span class="truncate">{title}</span>
{:else if field.type === 'rating' && typeof value === 'number'}
	<Rating {...ratingScale(field)} {value} size="sm" />
{:else if isContact(field.type) && typeof value === 'string'}
	<a
		href={hrefOf(field.type, value)}
		target={field.type === 'url' ? '_blank' : undefined}
		rel="noopener noreferrer"
		class="truncate underline decoration-edge underline-offset-2 hover:decoration-ink"
		>{formatValue(field, value)}</a
	>
{:else}
	<span class="truncate">{formatValue(field, value)}</span>
{/if}
