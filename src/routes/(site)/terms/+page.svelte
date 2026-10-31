<script lang="ts">
	import LegalSection from '#lib/site/LegalSection.svelte';
	import Seo from '#lib/site/Seo.svelte';
	import {
		CONTACT,
		LEGAL_NAME,
		LEGAL_REGISTRATION,
		LEGAL_UPDATED,
		REPOSITORY
	} from '#lib/site/site.ts';

	const link = 'text-ink underline underline-offset-2';
</script>

<Seo
	title="Terms"
	description="The terms for using Torsel at torsel.ilyasturki.com, and who runs it."
	path="/terms"
/>

<article class="mx-auto flex w-full max-w-prose flex-col gap-8 px-gutter py-16">
	<header class="flex flex-col gap-2">
		<h1 class="text-hero leading-none font-semibold tighter">Terms</h1>
		<p class="text-ink-3">Last updated {LEGAL_UPDATED}</p>
	</header>

	<p class="text-lg text-ink-2">
		These terms cover the service at torsel.ilyasturki.com. The code is a separate matter: it is
		<a class={link} href={REPOSITORY}>open source under the MIT license</a>, and you can run your
		own server under that license alone.
	</p>

	<LegalSection title="The service">
		<p>
			Torsel is free. You can use the app with no account, and your data then stays on your device.
			An account adds sync between your devices and the assistant.
		</p>
	</LegalSection>

	<LegalSection title="Your data">
		<p>
			What you enter stays yours. Running the service means storing and syncing it, and sending it
			to the providers listed on the <a class={link} href="/privacy">privacy page</a> when you use the
			features that need them. Torsel takes no other right over it.
		</p>
		<p>
			Keep your own copy of anything you care about. Settings exports all the data on your device as
			JSON.
		</p>
	</LegalSection>

	<LegalSection title="Fair use">
		<p>
			Keep your password and tokens to yourself. Don't use the service to break the law, attack it,
			or get around its limits. An account that does may be suspended.
		</p>
	</LegalSection>

	<LegalSection title="The assistant">
		<p>
			The assistant can be wrong. Rows it enters apply at once with an undo, and it asks before
			structural changes and deletions. Check what it does before you rely on it.
		</p>
	</LegalSection>

	<LegalSection title="No guarantee">
		<p>
			The service is provided as it is, with no promise of availability, and it can change or stop.
			If it is going to stop, account holders get notice by email with time to export. To the extent
			the law allows, {LEGAL_NAME} is not liable for lost data or indirect damage. Your rights as a consumer
			are not affected.
		</p>
	</LegalSection>

	<LegalSection title="Who runs Torsel">
		<p>
			{LEGAL_NAME}, {LEGAL_REGISTRATION}, France. Publisher: Ilyas Turki. Contact:
			<a class={link} href="mailto:{CONTACT}">{CONTACT}</a>.
		</p>
		<p>
			Host: Hetzner Online GmbH, Industriestraße 25, 91710 Gunzenhausen, Germany,
			<a class={link} href="https://www.hetzner.com">hetzner.com</a>.
		</p>
		<p>These terms are governed by French law.</p>
	</LegalSection>
</article>
