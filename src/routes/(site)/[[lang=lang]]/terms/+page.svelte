<script lang="ts">
	import { page } from '$app/state';

	import { site as t } from '#lib/i18n/site.ts';
	import LegalPage from '#lib/site/legal/LegalPage.svelte';
	import TermsEn from '#lib/site/legal/TermsEn.svelte';
	import TermsFr from '#lib/site/legal/TermsFr.svelte';
	import Seo from '#lib/site/Seo.svelte';

	const locale = $derived(page.params.lang ?? 'en');
</script>

<Seo title={t.terms} description={t.termsDescription} path="/terms" {locale} />

<LegalPage title={t.terms} updated={t.updated} {locale}>
	{#if locale === 'fr'}
		<TermsFr />
	{:else}
		<TermsEn />
	{/if}
</LegalPage>
