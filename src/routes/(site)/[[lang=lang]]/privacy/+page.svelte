<script lang="ts">
	import { page } from '$app/state';

	import { site as t } from '#lib/i18n/site.ts';
	import LegalPage from '#lib/site/legal/LegalPage.svelte';
	import PrivacyEn from '#lib/site/legal/PrivacyEn.svelte';
	import PrivacyFr from '#lib/site/legal/PrivacyFr.svelte';
	import Seo from '#lib/site/Seo.svelte';

	const locale = $derived(page.params.lang ?? 'en');
</script>

<Seo title={t.privacy} description={t.privacyDescription} path="/privacy" {locale} />

<LegalPage title={t.privacy} updated={t.updated} {locale}>
	{#if locale === 'fr'}
		<PrivacyFr />
	{:else}
		<PrivacyEn />
	{/if}
</LegalPage>
