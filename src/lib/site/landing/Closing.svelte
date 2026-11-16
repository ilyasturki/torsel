<script lang="ts">
	import { HOME } from '#lib/client/paths.ts';
	import { site as t } from '#lib/i18n/site.ts';

	import { REPOSITORY } from '../site.ts';
	import CellField from './CellField.svelte';
	import { CTA } from './styles.ts';
</script>

<CellField
	shape="band"
	class="grid justify-items-center gap-6 rounded-panel px-5 py-24 text-center max-lg:py-16"
>
	<h2 class="text-h2 leading-tight font-semibold tighter text-balance">{t.closeTitle}</h2>
	<p class="max-w-md text-lg font-medium text-balance">
		{t.closeLead}
		<a class="underline underline-offset-3" href={REPOSITORY}>{t.code}</a>
	</p>
	<a class={CTA} href={HOME}>{t.start}</a>
</CellField>
