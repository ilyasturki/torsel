<script lang="ts">
	import LegalPage from '#lib/site/legal/LegalPage.svelte';
	import PrivacyEn from '#lib/site/legal/PrivacyEn.svelte';
	import Seo from '#lib/site/Seo.svelte';
</script>

<Seo
	title="Privacy"
	description="What stays on your device when you use Torsel, what leaves it, and who receives it."
	path="/privacy"
/>

<LegalPage title="Privacy" updated="Last updated" locale="en">
	<PrivacyEn />
</LegalPage>
