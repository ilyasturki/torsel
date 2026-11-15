<script lang="ts">
	import { HOME } from '#lib/client/paths.ts';
	import { siteCopy } from '#lib/i18n/site.ts';

	import { REPOSITORY } from '../site.ts';
	import { CTA } from './styles.ts';

	let { locale = 'en' }: { locale?: 'en' | 'fr' } = $props();
	const t = $derived(siteCopy[locale]);
</script>

<section
	class="grid justify-items-center gap-6 rounded-panel bg-glass px-5 py-16 text-center shadow-raised backdrop-blur-glass max-lg:py-12"
>
	<h2 class="text-h2 leading-tight font-semibold tighter text-balance">{t.closeTitle}</h2>
	<p class="max-w-md text-lg text-balance text-ink-2">
		{t.closeLead}
		<a class="text-ink underline underline-offset-3" href={REPOSITORY}>{t.code}</a>
	</p>
	<a class={CTA} href={HOME}>{t.start}</a>
</section>
