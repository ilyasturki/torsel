<script lang="ts">
	import { HOME } from '#lib/client/paths.ts';
	import { site as t } from '#lib/i18n/site.ts';

	import CellField from './CellField.svelte';
	import { CTA } from './styles.ts';

	let copy = $state<HTMLElement>();
</script>

<CellField
	shape="chart"
	keep={copy}
	class="grid min-h-hero content-start px-gutter pt-36 pb-16 max-lg:min-h-svh max-lg:pt-28"
>
	<div bind:this={copy} class="grid justify-items-start gap-5 justify-self-start">
		<h1 class="max-w-hero-copy text-h1 leading-none font-semibold tighter text-balance">
			{t.headline}
		</h1>
		<p class="max-w-md text-lg font-medium text-balance text-ink-2 lg:text-xl">{t.lead}</p>
		<a class={CTA} href={HOME}>{t.start}</a>
	</div>
</CellField>
