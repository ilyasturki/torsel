<script lang="ts">
	import LegalPage from '#lib/site/legal/LegalPage.svelte';
	import TermsEn from '#lib/site/legal/TermsEn.svelte';
	import Seo from '#lib/site/Seo.svelte';
</script>

<Seo
	title="Terms"
	description="The terms for using Torsel at torsel.ilyasturki.com, and who runs it."
	path="/terms"
/>

<LegalPage title="Terms" updated="Last updated" locale="en">
	<TermsEn />
</LegalPage>
