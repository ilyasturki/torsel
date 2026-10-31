<script lang="ts">
	import type { Inline } from '#lib/core/markdown.ts';
	import { parseMarkdown } from '#lib/core/markdown.ts';

	let { text }: { text: string } = $props();

	const blocks = $derived(parseMarkdown(text));
</script>

{#snippet inline(parts: Inline[])}
	{#each parts as part, index (index)}
		{#if part.kind === 'strong'}<strong class="font-semibold">{part.text}</strong>
		{:else if part.kind === 'em'}<em>{part.text}</em>
		{:else if part.kind === 'code'}<code class="rounded-box bg-tint px-1 font-mono text-sm"
				>{part.text}</code
			>
		{:else}{part.text}{/if}
	{/each}
{/snippet}

<div class="flex flex-col gap-2 break-words">
	{#each blocks as block, index (index)}
		{#if block.kind === 'heading'}
			<p class="font-semibold">{@render inline(block.inline)}</p>
		{:else if block.kind === 'paragraph'}
			<p>{@render inline(block.inline)}</p>
		{:else if block.kind === 'list'}
			<svelte:element
				this={block.ordered ? 'ol' : 'ul'}
				class="flex flex-col gap-1 pl-5 {block.ordered ? 'list-decimal' : 'list-disc'}"
			>
				{#each block.items as item, at (at)}
					<li>{@render inline(item)}</li>
				{/each}
			</svelte:element>
		{:else if block.kind === 'code'}
			<pre class="overflow-x-auto rounded-box bg-tint p-2 font-mono text-sm">{block.text}</pre>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full text-left">
					<thead>
						<tr class="text-sm text-ink-3">
							{#each block.head as cell, at (at)}
								<th class="py-1 pr-3 font-medium whitespace-nowrap">{@render inline(cell)}</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each block.rows as row, at (at)}
							<tr class="border-t border-hair">
								{#each row as cell, col (col)}
									<td class="py-1 pr-3 whitespace-nowrap">{@render inline(cell)}</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	{/each}
</div>
