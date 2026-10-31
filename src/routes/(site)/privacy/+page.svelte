<script lang="ts">
	import LegalSection from '#lib/site/LegalSection.svelte';
	import Seo from '#lib/site/Seo.svelte';
	import { CONTACT, LEGAL_NAME, LEGAL_UPDATED } from '#lib/site/site.ts';

	const link = 'text-ink underline underline-offset-2';
</script>

<Seo
	title="Privacy"
	description="What stays on your device when you use Torsel, what leaves it, and who receives it."
	path="/privacy"
/>

<article class="flex flex-col gap-8 rounded-panel bg-raised p-5 shadow-raised lg:px-16 lg:py-14">
	<header class="flex max-w-prose flex-col gap-2">
		<h1 class="text-hero leading-none font-semibold tighter">Privacy</h1>
		<p class="text-ink-3">Last updated {LEGAL_UPDATED}</p>
	</header>

	<p class="text-lg text-ink-2">
		This page covers torsel.ilyasturki.com, run by {LEGAL_NAME}. A server you host yourself is yours
		to run, and this page does not apply to it.
	</p>

	<LegalSection title="With no account">
		<p>
			The app runs in your browser. Your tables live in this browser's storage and nothing you enter
			is sent to a server. The Android app works the same way until you connect it to one.
		</p>
		<p>
			Clearing the browser's site data deletes those tables, so export them from Settings if you
			want a copy.
		</p>
	</LegalSection>

	<LegalSection title="With an account">
		<p>
			An account adds sync and the assistant. The server stores your email address, a hash of your
			password if you set one, and the session tokens of your devices. Your tables, fields, views
			and rows are copied to the server so your devices can sync.
		</p>
		<p>
			This data runs the service and nothing else. It is not sold, and it is not used for
			advertising.
		</p>
	</LegalSection>

	<LegalSection title="The assistant">
		<p>
			The assistant runs only when you ask it something. Your messages, and the table data it reads
			to answer you, are sent to Anthropic, which runs the model. Under
			<a class={link} href="https://www.anthropic.com/legal/commercial-terms">
				Anthropic's commercial terms
			</a>
			that content is not used to train its models. If you never open the assistant, nothing goes to Anthropic.
		</p>
	</LegalSection>

	<LegalSection title="Email and Google">
		<p>
			Sign-in links and codes are sent through Brevo, which receives your email address and the
			message.
		</p>
		<p>
			If you choose to sign in with Google, Google tells Torsel your email address and that it is
			verified. Torsel never needs a Google account.
		</p>
	</LegalSection>

	<LegalSection title="MCP clients">
		<p>
			A token you create in Settings lets the MCP client you give it to read and write your data.
			What that client does with the data is between you and whoever makes it. You can revoke a
			token in Settings at any time.
		</p>
	</LegalSection>

	<LegalSection title="Cookies and tracking">
		<p>
			There is one cookie, <code class="font-mono text-sm">torsel_session</code>, set when you sign
			in and used to keep you signed in. Torsel has no analytics, no ads and no third-party scripts.
		</p>
	</LegalSection>

	<LegalSection title="Hosting and logs">
		<p>
			The server runs at Hetzner in Germany. The reverse proxy writes no access logs. The app logs
			errors for diagnosis, and it counts failed sign-ins by IP address in memory to slow down
			password guessing.
		</p>
	</LegalSection>

	<LegalSection title="Your rights">
		<p>
			You can ask to access, correct, delete or receive your data, or object to how it is used.
			Settings exports everything on your device as JSON. To delete your account and the server's
			copy of your data, write to <a class={link} href="mailto:{CONTACT}">{CONTACT}</a>.
		</p>
		<p>
			Personal data is processed to provide the service you asked for. You can also complain to the
			<a class={link} href="https://www.cnil.fr/en">CNIL</a>, the French data protection authority.
		</p>
	</LegalSection>
</article>
