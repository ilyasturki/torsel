<script lang="ts">
	import { HOME } from '#lib/client/paths.ts';
	import { site as t } from '#lib/i18n/site.ts';

	import { CTA } from './styles.ts';
</script>

<section class="grid justify-items-center gap-5 px-4 text-center lg:-mb-10">
	<h1 class="max-w-headline text-h1 leading-none font-semibold tighter text-balance">
		{t.headline}
	</h1>
	<p class="max-w-md text-lg font-medium text-balance lg:text-xl">{t.lead}</p>
	<a class={CTA} href={HOME}>{t.start}</a>
</section>
